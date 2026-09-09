import { type ChildProcess, spawn } from 'node:child_process';
import { platform } from 'node:os';
import wrtc from '@roamhq/wrtc';
import {
  i420FrameBytes,
  rawVideoPlayerArgs,
  SCREEN_FPS,
  screenCaptureCandidates,
  screenOutputSize,
  WEBCAM_FPS,
  WEBCAM_FRAME_BYTES,
  WEBCAM_HEIGHT,
  WEBCAM_WIDTH,
  webcamCaptureArgs,
} from './capture-args.js';
import type { ScreenDevice } from './devices.js';
import { renderOverlay } from './overlay.js';
import { ffmpegBin, ffplayBin } from './tool-path.js';

// @roamhq/wrtc's type definitions omit the video nonstandard APIs
const { RTCVideoSink, RTCVideoSource } = wrtc.nonstandard as any;

/** Frames of slack allowed in ffplay's stdin before we start dropping. */
const MAX_WRITE_FRAMES = 3;
/** Write buffers rotated per peer. Larger than the queue cap, so none in flight is reused. */
const WRITE_RING = MAX_WRITE_FRAMES + 2;

/** How long a still screen may go without a frame before we re-send the last one. */
const SCREEN_REFRESH_MS = 1000;

/**
 * Assembles fixed-size raw frames out of a pipe, without reallocating.
 *
 * ffmpeg hands over ~64 KB at a time and a 1080p I420 frame is 3.1 MB, so growing a Buffer
 * with `Buffer.concat` re-copies the partial frame on every chunk: 2.3 GB/s of memcpy at
 * 1080p30, on the very event loop the 10 ms audio cadence runs on. Filling one preallocated
 * frame copies each byte once — measured 5.22 ms/frame down to 0.03 ms/frame.
 *
 * The frame buffer is reused, so consumers must finish with it before returning. When a
 * single chunk completes several frames (only after a stall) the older ones are skipped:
 * they are already stale, and skipping them costs nothing because the next frame simply
 * overwrites them.
 */
class FrameAssembler {
  private readonly frame: Uint8ClampedArray;
  private readonly view: Buffer;
  private filled = 0;

  constructor(private readonly frameBytes: number) {
    this.frame = new Uint8ClampedArray(frameBytes);
    this.view = Buffer.from(this.frame.buffer);
  }

  /** Feed one chunk. Returns how many stale frames were skipped. */
  push(chunk: Buffer, onFrame: (frame: Uint8ClampedArray) => void): number {
    const total = this.filled + chunk.length;
    const completing = Math.floor(total / this.frameBytes);
    if (completing === 0) {
      chunk.copy(this.view, this.filled);
      this.filled = total;
      return 0;
    }

    // Only the newest complete frame is worth delivering — the ones before it are already
    // stale by the time we would encode them — so seek straight to it instead of copying
    // bytes we would immediately overwrite. At 3.1 MB a frame that memcpy would land on the
    // event loop at the one moment it is already behind.
    const lastFrameStart = (completing - 1) * this.frameBytes - this.filled;
    if (lastFrameStart > 0) this.filled = 0;
    const from = Math.max(lastFrameStart, 0);
    chunk.copy(this.view, this.filled, from, from + this.frameBytes - this.filled);
    this.filled = 0;
    onFrame(this.frame);

    // Whatever trails the delivered frame begins the next one.
    const tail = total - completing * this.frameBytes;
    if (tail > 0) {
      chunk.copy(this.view, 0, chunk.length - tail);
      this.filled = tail;
    }
    return completing - 1;
  }

  get residual(): number {
    return this.filled;
  }
}

/** How long a screen grabber may stay silent before it counts as failed. */
const SCREEN_SILENCE_MS = 8000;

/**
 * SIGTERM, then SIGKILL two seconds later if it is still there. An avfoundation ffmpeg
 * wedged inside ScreenCaptureKit ignores SIGTERM, and every one left behind keeps a capture
 * stream open — three of them were found alive at once on 2026-09-09.
 */
function killHard(proc: ChildProcess): void {
  proc.kill();
  const timer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  }, 2000);
  proc.once('close', () => clearTimeout(timer));
}

export function createVideoSource(options?: { isScreencast?: boolean }): { source: any; track: any } {
  const source = new RTCVideoSource(options?.isScreencast ? { isScreencast: true } : undefined);
  const track = source.createTrack();
  return { source, track };
}

interface PeerVideoPlayback {
  sink: any;
  ffplayProcess: ChildProcess | null;
  track: any;
  peerId: string;
  streamType: 'webcam' | 'screen';
  peerName: string;
  windowClosed: boolean;
  /** Geometry the running ffplay was told about; a frame of another size respawns it. */
  width: number;
  height: number;
  /** Rotated so a buffer is never rewritten while its `write()` is still queued. */
  ring: Buffer[];
  ringIndex: number;
}

export class VideoManager {
  private peers = new Map<string, PeerVideoPlayback>();
  private captureProcess: ChildProcess | null = null;
  private videoSource: any = null;
  private _isVideoMuted = true; // starts muted — no camera by default
  private capturing = false;
  private screenCaptureProcess: ChildProcess | null = null;
  private screenRefreshTimer: ReturnType<typeof setInterval> | null = null;
  overlayEnabled = true;
  onDebug?: (msg: string) => void;
  onWindowClosed?: (peerId: string, streamType: 'webcam' | 'screen') => void;
  /** The screen capture stopped without us asking; `reason` is what the room log should say. */
  onScreenCaptureEnded?: (reason: string) => void;

  constructor(options?: { onDebug?: (msg: string) => void }) {
    this.onDebug = options?.onDebug;
  }

  // ─── Receive ───────────────────────────────────────────────────────

  addRemotePeer(peerId: string, track: any, streamType: 'webcam' | 'screen', peerName: string): void {
    const key = `${peerId}:${streamType}`;
    this.removeRemotePeer(peerId, streamType);

    try {
      const sink = new RTCVideoSink(track);
      const peer: PeerVideoPlayback = {
        sink,
        ffplayProcess: null,
        track,
        peerId,
        streamType,
        windowClosed: false,
        peerName,
        width: 0,
        height: 0,
        ring: [],
        ringIndex: 0,
      };
      this.peers.set(key, peer);
      this.wireSink(peer);
      this.onDebug?.(`Video peer added: ${peerName} (${streamType})`);
    } catch {
      // RTCVideoSink setup failed — non-fatal
    }
  }

  removeRemotePeer(peerId: string, streamType: 'webcam' | 'screen'): void {
    const key = `${peerId}:${streamType}`;
    const peer = this.peers.get(key);
    if (peer) {
      this.cleanupPeer(peer);
      this.peers.delete(key);
      this.onDebug?.(`Video peer removed: ${peer.peerName} (${streamType})`);
    }
  }

  removeAllForPeer(peerId: string): void {
    for (const streamType of ['webcam', 'screen'] as const) {
      this.removeRemotePeer(peerId, streamType);
    }
  }

  private cleanupPeer(peer: PeerVideoPlayback): void {
    try {
      peer.sink.stop();
    } catch {
      // Already stopped
    }
    if (peer.ffplayProcess) {
      peer.ffplayProcess.stdin?.end();
      peer.ffplayProcess.kill('SIGKILL');
      peer.ffplayProcess = null;
    }
  }

  /**
   * Spawn ffplay for this peer's current frame geometry.
   *
   * Raw frames carry no geometry, so ffplay has to be told once at spawn. That is the only
   * reason the pipe has a fixed size — and the reason a resolution change restarts the
   * window instead of costing a rescale on every frame. Scaling to whatever size the user
   * drags the window to is ffplay's job, and it does it on the GPU for free.
   */
  private spawnFfplay(peer: PeerVideoPlayback, width: number, height: number): void {
    const title = `${peer.peerName} (${peer.streamType})`;
    const proc = spawn(ffplayBin(), rawVideoPlayerArgs(width, height, 30, title), {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    peer.ffplayProcess = proc;
    peer.width = width;
    peer.height = height;
    const frameBytes = i420FrameBytes(width, height);
    peer.ring = Array.from({ length: WRITE_RING }, () => Buffer.allocUnsafe(frameBytes));
    peer.ringIndex = 0;

    proc.on('close', () => {
      peer.ffplayProcess = null;
      // The user closing the window means "stop showing me this", not "reopen it".
      peer.windowClosed = true;
      this.onWindowClosed?.(peer.peerId, peer.streamType);
    });
    proc.on('error', () => {
      peer.ffplayProcess = null;
    });
    proc.stdin?.on('error', () => {
      // ffplay went away between the writable check and the write.
    });
    this.onDebug?.(`ffplay started for ${peer.peerName} (${peer.streamType}) ${width}x${height}`);
  }

  /**
   * Wire RTCVideoSink to ffplay, 1:1. Frames go out at the resolution they arrived in —
   * rescaling them in JS used to cost 2.66 ms per frame on Apple Silicon and 6.5 ms on the
   * Windows box, on the same event loop as the 10 ms audio cadence, and it threw away
   * pixels we had already paid to encode and transmit.
   */
  private wireSink(peer: PeerVideoPlayback): void {
    peer.sink.onframe = ({ frame }: { frame: { width: number; height: number; data: Uint8Array } }) => {
      const { width, height, data } = frame;
      if (peer.windowClosed) return;

      if (!peer.ffplayProcess || peer.width !== width || peer.height !== height) {
        if (peer.ffplayProcess) {
          this.onDebug?.(`${peer.peerName} (${peer.streamType}) now ${width}x${height}, restarting window`);
          const old = peer.ffplayProcess;
          peer.ffplayProcess = null;
          // Our own kill must not be read as the user closing the window.
          old.removeAllListeners('close');
          old.stdin?.end();
          old.kill('SIGKILL');
        }
        this.spawnFfplay(peer, width, height);
      }

      const stdin = peer.ffplayProcess?.stdin;
      const frameBytes = i420FrameBytes(width, height);
      if (!stdin?.writable || stdin.writableLength >= frameBytes * MAX_WRITE_FRAMES) return;

      // A copy is required regardless: the sink reuses `data`, and Node queues a pending
      // write by reference, so writing a shared buffer would corrupt frames already queued.
      const out = peer.ring[peer.ringIndex];
      peer.ringIndex = (peer.ringIndex + 1) % peer.ring.length;
      Buffer.from(data.buffer, data.byteOffset, frameBytes).copy(out);
      if (this.overlayEnabled) {
        renderOverlay(out, width, height, peer.peerName, peer.streamType);
      }
      stdin.write(out);
    };
  }

  // ─── Send ──────────────────────────────────────────────────────────

  startCapture(videoSource: any, device?: string): void {
    if (this.capturing) return;
    const args = webcamCaptureArgs(device);
    if (!args) {
      this.onDebug?.('Webcam capture is not available on this platform');
      return;
    }
    this.capturing = true;
    this.videoSource = videoSource;

    this.captureProcess = spawn(ffmpegBin(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const assembler = new FrameAssembler(WEBCAM_FRAME_BYTES);

    // Pre-allocate black frame for muted state (Y=0, U=128, V=128)
    const blackFrame = new Uint8ClampedArray(WEBCAM_FRAME_BYTES);
    const ySize = WEBCAM_WIDTH * WEBCAM_HEIGHT;
    // Y plane: all zeros (already)
    // U and V planes: fill with 128
    blackFrame.fill(128, ySize);

    this.captureProcess.stdout?.on('data', (chunk: Buffer) => {
      const dropped = assembler.push(chunk, (frame) => {
        this.videoSource.onFrame({
          width: WEBCAM_WIDTH,
          height: WEBCAM_HEIGHT,
          data: this._isVideoMuted ? blackFrame : frame,
        });
      });
      if (dropped) this.onDebug?.(`Video capture behind, skipped ${dropped} stale frames`);
    });

    // Log ffmpeg errors for debugging
    let stderrBuf = '';
    this.captureProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      // Only log once we have a complete line
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this.onDebug?.(`ffmpeg: ${line.trim()}`);
      }
    });

    this.captureProcess.on('error', () => {
      this.capturing = false;
      this.onDebug?.('Video capture failed to start');
    });

    this.captureProcess.on('close', () => {
      this.capturing = false;
      this.onDebug?.('Video capture stopped');
    });

    this.onDebug?.(`Video capture started (${WEBCAM_WIDTH}x${WEBCAM_HEIGHT}@${WEBCAM_FPS}fps)`);
  }

  stopCapture(): void {
    if (this.captureProcess) {
      this.captureProcess.kill();
      this.captureProcess = null;
    }
    this.capturing = false;
  }

  get isCapturing(): boolean {
    return this.capturing;
  }

  // ─── Mute ──────────────────────────────────────────────────────────

  get isVideoMuted(): boolean {
    return this._isVideoMuted;
  }

  toggleMute(): boolean {
    this._isVideoMuted = !this._isVideoMuted;
    return this._isVideoMuted;
  }

  // ─── Screen capture (send) ─────────────────────────────────────────

  get isScreenSharing(): boolean {
    return this.screenCaptureProcess !== null;
  }

  /** Returns the shape the share goes out at, for the bandwidth budget. */
  startScreenCapture(screenVideoSource: any, device: ScreenDevice): { width: number; height: number } {
    const shape = screenOutputSize(device);
    if (!this.screenCaptureProcess) {
      this.spawnScreenCapture(screenVideoSource, device, shape, screenCaptureCandidates(device), 0);
    }
    return shape;
  }

  /** Runs candidate `index`; if it yields no frames, moves on to the next one. */
  private spawnScreenCapture(
    screenVideoSource: any,
    device: ScreenDevice,
    shape: { width: number; height: number },
    candidates: string[][],
    index: number,
  ): void {
    const args = candidates[index];
    const { width, height } = shape;
    const frameBytes = i420FrameBytes(width, height);
    this.onDebug?.(`Screen ffmpeg args: ffmpeg ${args.join(' ')}`);
    this.onDebug?.(`Screen expected frame size: ${frameBytes} bytes (${width}x${height} I420)`);

    this.screenCaptureProcess = spawn(ffmpegBin(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const proc = this.screenCaptureProcess;

    const assembler = new FrameAssembler(frameBytes);
    let screenFrameCount = 0;
    let loggedFirstChunk = false;
    let lastScreenLog = Date.now();
    let totalBytesReceived = 0;

    // With change-driven capture a still desktop produces no frames at all, so a peer that
    // joins mid-share would have nothing to build a keyframe from. Re-push the last frame
    // when the screen has been quiet: 3 MB/s for one frame per second, against a black window.
    let lastFrame: Uint8ClampedArray | null = null;
    let lastFrameAt = 0;
    const sendFrame = (frame: Uint8ClampedArray) => {
      lastFrame = frame;
      lastFrameAt = Date.now();
      screenVideoSource.onFrame({ width, height, data: frame });
      screenFrameCount++;
    };
    this.clearScreenRefresh();
    this.screenRefreshTimer = setInterval(() => {
      if (lastFrame && Date.now() - lastFrameAt >= SCREEN_REFRESH_MS) sendFrame(lastFrame);
    }, SCREEN_REFRESH_MS);

    // A grabber that produces nothing does not exit either: avfoundation on macOS sits at
    // 20% CPU forever when ScreenCaptureKit is wedged or the terminal lacks the Screen
    // Recording permission (2026-09-09: three shares in a row worked, then every capture
    // after a 28-minute one went silent until the daemon was restarted), and ddagrab in an
    // RDP session does the same. So silence is a failure too, after a grace period long
    // enough for the first frame on a slow machine.
    let silentFailure = false;
    const silenceTimer = setTimeout(() => {
      if (this.screenCaptureProcess !== proc) return;
      silentFailure = true;
      this.onDebug?.(`Screen capture produced no data in ${SCREEN_SILENCE_MS / 1000} s; giving up on this grabber`);
      killHard(proc);
    }, SCREEN_SILENCE_MS);

    this.screenCaptureProcess.stdout?.on('data', (chunk: Buffer) => {
      totalBytesReceived += chunk.length;

      if (!loggedFirstChunk) {
        loggedFirstChunk = true;
        clearTimeout(silenceTimer);
        this.onDebug?.(`Screen ffmpeg first data: ${chunk.length} bytes (frame is ${frameBytes})`);
      }

      const dropped = assembler.push(chunk, sendFrame);
      if (dropped) this.onDebug?.(`Screen capture behind, skipped ${dropped} stale frames`);

      // Log stats every 5 seconds
      const now = Date.now();
      if (now - lastScreenLog > 5000) {
        this.onDebug?.(
          `Screen capture: ${screenFrameCount} frames sent, ${Math.round(totalBytesReceived / 1024 / 1024)}MB received from ffmpeg, buffer residual: ${assembler.residual} bytes`,
        );
        lastScreenLog = now;
      }
    });

    let stderrBuf = '';
    this.screenCaptureProcess.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this.onDebug?.(`ffmpeg screen: ${line.trim()}`);
      }
    });

    proc.on('error', () => {
      this.onDebug?.('Screen capture failed to start');
    });
    proc.on('close', (code) => {
      clearTimeout(silenceTimer);
      // False when a newer capture already occupies the slot, or when stopScreenCapture
      // cleared it — in both cases this exit was asked for: no retry, and above all no
      // "capture ended" for the share that is running now (a late-dying orphan used to
      // stop the live share that had replaced it).
      const wasCurrent = this.screenCaptureProcess === proc;
      if (!wasCurrent) {
        this.onDebug?.(`Screen capture ${proc.pid} exited (${code}) after being replaced or stopped`);
        return;
      }
      this.screenCaptureProcess = null;
      this.clearScreenRefresh();

      const next = index + 1;
      if (screenFrameCount === 0 && next < candidates.length) {
        this.onDebug?.(`Screen capture produced no frames (ffmpeg exit ${code}); trying the next grabber`);
        this.spawnScreenCapture(screenVideoSource, device, shape, candidates, next);
        return;
      }

      const reason = silentFailure
        ? `no frames in ${SCREEN_SILENCE_MS / 1000} s — screen recording permission for this terminal, or a stuck capture${platform() === 'darwin' ? ' (quit and reopen your terminal app, or check Screen Recording in Privacy & Security)' : ''}`
        : screenFrameCount === 0
          ? `capture exited without frames (ffmpeg exit ${code}) — check screen recording permission / ffmpeg`
          : `capture ended (ffmpeg exit ${code})`;
      this.onDebug?.(`Screen capture ended: ${reason}`);
      this.onScreenCaptureEnded?.(reason);
    });

    this.onDebug?.(`Screen capture started (${width}x${height}@${SCREEN_FPS}fps from ${device.name})`);
  }

  private clearScreenRefresh(): void {
    if (!this.screenRefreshTimer) return;
    clearInterval(this.screenRefreshTimer);
    this.screenRefreshTimer = null;
  }

  stopScreenCapture(): void {
    this.clearScreenRefresh();
    const proc = this.screenCaptureProcess;
    if (!proc) return;
    this.screenCaptureProcess = null;
    killHard(proc);
  }

  // ─── Cleanup ───────────────────────────────────────────────────────

  shutdown(): void {
    this.stopCapture();
    this.stopScreenCapture();
    for (const [, peer] of this.peers) {
      this.cleanupPeer(peer);
    }
    this.peers.clear();
  }
}
