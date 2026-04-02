import { type ChildProcess, spawn } from 'node:child_process';
import { platform } from 'node:os';
import wrtc from '@roamhq/wrtc';
import type { ScreenDevice } from './devices.js';
import { renderOverlay } from './overlay.js';

const { RTCVideoSink, RTCVideoSource } = wrtc.nonstandard;

// Display: ffplay output resolution (fixed — we rescale any input to this in JS)
const DISPLAY_WIDTH = 1280;
const DISPLAY_HEIGHT = 720;
const DISPLAY_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 1.5; // I420

// Webcam capture settings
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;
const CAPTURE_FPS = 30;
const CAPTURE_FRAME_BYTES = CAPTURE_WIDTH * CAPTURE_HEIGHT * 1.5; // I420

// Screen capture settings — 1080p@30fps keeps the raw I420 pipe under ~93MB/s.
// Higher resolutions overwhelm the Node.js event loop with raw frame data.
const SCREEN_MAX_WIDTH = 1920;
const SCREEN_MAX_HEIGHT = 1080;
const SCREEN_FPS = 30;

// Backpressure: max bytes buffered in ffplay stdin before dropping frames.
// ~5 frames at 720p ≈ 7MB — generous enough to absorb event loop stalls.
const MAX_WRITE_BUFFER = DISPLAY_FRAME_BYTES * 5;

// Pre-allocate output buffers for rescaled frames (reused across all peers)
const scaledFrame = Buffer.alloc(DISPLAY_FRAME_BYTES);
const fitFrame = Buffer.alloc(DISPLAY_FRAME_BYTES); // intermediate buffer for letterboxing

/**
 * Bilinear I420 rescale — blends 4 neighboring source pixels for smooth output.
 * Uses 16.16 fixed-point mapping with 8-bit interpolation fractions.
 */
function bilinearPlane(
  src: Uint8Array,
  srcOff: number,
  srcW: number,
  srcH: number,
  dst: Buffer,
  dstOff: number,
  dstW: number,
  dstH: number,
): void {
  if (dstW <= 1 || dstH <= 1 || srcW <= 1 || srcH <= 1) {
    dst.fill(src[srcOff] ?? 0, dstOff, dstOff + dstW * dstH);
    return;
  }

  const xRatio = (((srcW - 1) << 16) / (dstW - 1)) | 0;
  const yRatio = (((srcH - 1) << 16) / (dstH - 1)) | 0;
  const srcWMax = srcW - 1;
  const srcHMax = srcH - 1;

  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = sy >> 16;
    const yf = (sy >> 8) & 0xff;
    const yfi = 256 - yf;
    const y1 = y0 < srcHMax ? y0 + 1 : y0;
    const r0 = srcOff + y0 * srcW;
    const r1 = srcOff + y1 * srcW;
    const dr = dstOff + y * dstW;

    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = sx >> 16;
      const xf = (sx >> 8) & 0xff;
      const xfi = 256 - xf;
      const x1 = x0 < srcWMax ? x0 + 1 : x0;

      dst[dr + x] =
        (src[r0 + x0] * xfi * yfi + src[r0 + x1] * xf * yfi + src[r1 + x0] * xfi * yf + src[r1 + x1] * xf * yf) >> 16;
    }
  }
}

/**
 * Bilinear I420 rescale. Scales Y, U, V planes independently.
 * I420 layout: Y plane (WxH) + U plane (W/2 x H/2) + V plane (W/2 x H/2).
 */
function scaleI420(src: Uint8Array, srcW: number, srcH: number, dst: Buffer, dstW: number, dstH: number): void {
  const srcUOff = srcW * srcH;
  const srcVOff = srcUOff + (srcW >> 1) * (srcH >> 1);
  const dstUOff = dstW * dstH;
  const dstVOff = dstUOff + (dstW >> 1) * (dstH >> 1);

  bilinearPlane(src, 0, srcW, srcH, dst, 0, dstW, dstH);
  bilinearPlane(src, srcUOff, srcW >> 1, srcH >> 1, dst, dstUOff, dstW >> 1, dstH >> 1);
  bilinearPlane(src, srcVOff, srcW >> 1, srcH >> 1, dst, dstVOff, dstW >> 1, dstH >> 1);
}

export function createVideoSource(): { source: any; track: any } {
  const source = new RTCVideoSource();
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
}

/** Compute output dimensions to fit within max bounds, preserving aspect ratio. */
function fitDimensions(srcW: number, srcH: number, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(maxW / srcW, maxH / srcH, 1); // don't upscale
  let width = Math.round(srcW * scale);
  let height = Math.round(srcH * scale);
  // Ensure even dimensions (required for I420)
  width &= ~1;
  height &= ~1;
  return { width: Math.max(width, 2), height: Math.max(height, 2) };
}

export class VideoManager {
  private peers = new Map<string, PeerVideoPlayback>();
  private captureProcess: ChildProcess | null = null;
  private videoSource: any = null;
  private _isVideoMuted = true; // starts muted — no camera by default
  private capturing = false;
  private screenCaptureProcess: ChildProcess | null = null;
  private _isScreenSharing = false;
  private screenCapturing = false;
  overlayEnabled = true;
  onDebug?: (msg: string) => void;
  onWindowClosed?: (peerId: string, streamType: 'webcam' | 'screen') => void;

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

  /** Spawn ffplay at the fixed display resolution. Called once per peer. */
  private spawnFfplay(peer: PeerVideoPlayback): void {
    const title = `${peer.peerName} (${peer.streamType})`;
    const proc = spawn(
      'ffplay',
      [
        '-f',
        'rawvideo',
        '-pixel_format',
        'yuv420p',
        '-video_size',
        `${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}`,
        '-framerate',
        '30',
        '-window_title',
        title,
        '-loglevel',
        'quiet',
        '-i',
        'pipe:0',
      ],
      { stdio: ['pipe', 'ignore', 'ignore'] },
    );

    peer.ffplayProcess = proc;
    proc.on('error', () => {
      peer.ffplayProcess = null;
    });
    proc.on('close', () => {
      peer.ffplayProcess = null;
      peer.windowClosed = true;
      this.onWindowClosed?.(peer.peerId, peer.streamType);
    });
    proc.stdin?.on('error', () => {});

    this.onDebug?.(`ffplay started for ${peer.peerName} (${peer.streamType}) ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}`);
  }

  /**
   * Wire RTCVideoSink directly to ffplay. Frames are rescaled in JS using
   * bilinear I420 scaling to fit within the fixed display resolution while
   * preserving aspect ratio (letterbox/pillarbox with black bars).
   */
  private wireSink(peer: PeerVideoPlayback): void {
    peer.sink.onframe = ({ frame }: { frame: { width: number; height: number; data: Uint8Array } }) => {
      const { width, height, data } = frame;

      // Lazy-spawn ffplay on first frame (skip if user closed the window)
      if (!peer.ffplayProcess) {
        if (peer.windowClosed) return;
        this.spawnFfplay(peer);
      }

      // Scale to fit within DISPLAY_WIDTH x DISPLAY_HEIGHT preserving aspect ratio.
      // Fill the output with black first, then scale into the centered sub-rect.
      const srcAspect = width / height;
      const dstAspect = DISPLAY_WIDTH / DISPLAY_HEIGHT;

      let fitW: number;
      let fitH: number;
      if (srcAspect > dstAspect) {
        // Source is wider — letterbox (black bars top/bottom)
        fitW = DISPLAY_WIDTH;
        fitH = Math.round(DISPLAY_WIDTH / srcAspect);
      } else {
        // Source is taller — pillarbox (black bars left/right)
        fitH = DISPLAY_HEIGHT;
        fitW = Math.round(DISPLAY_HEIGHT * srcAspect);
      }
      // Ensure even dimensions (required for I420 chroma subsampling)
      fitW &= ~1;
      fitH &= ~1;

      if (fitW === DISPLAY_WIDTH && fitH === DISPLAY_HEIGHT) {
        // Perfect fit — no letterboxing needed
        if (width === DISPLAY_WIDTH && height === DISPLAY_HEIGHT) {
          data.copy ? (data as any).copy(scaledFrame) : scaledFrame.set(data);
        } else {
          scaleI420(data, width, height, scaledFrame, DISPLAY_WIDTH, DISPLAY_HEIGHT);
        }
      } else {
        // Fill with black (Y=0, U=128, V=128)
        const ySize = DISPLAY_WIDTH * DISPLAY_HEIGHT;
        const uvSize = (DISPLAY_WIDTH >> 1) * (DISPLAY_HEIGHT >> 1);
        scaledFrame.fill(0, 0, ySize);
        scaledFrame.fill(128, ySize, ySize + uvSize * 2);

        // Scale source into pre-allocated intermediate buffer at the fitted size
        scaleI420(data, width, height, fitFrame, fitW, fitH);

        // Copy fitted frame into the center of the display frame (I420 plane by plane)
        const offX = (DISPLAY_WIDTH - fitW) >> 1;
        const offY = (DISPLAY_HEIGHT - fitH) >> 1;

        // Y plane
        for (let y = 0; y < fitH; y++) {
          fitFrame.copy(scaledFrame, (offY + y) * DISPLAY_WIDTH + offX, y * fitW, y * fitW + fitW);
        }
        // U plane
        const fitUOff = fitW * fitH;
        const dstUOff = ySize;
        const fitUW = fitW >> 1;
        const fitUH = fitH >> 1;
        const dstUW = DISPLAY_WIDTH >> 1;
        const uOffX = offX >> 1;
        const uOffY = offY >> 1;
        for (let y = 0; y < fitUH; y++) {
          fitFrame.copy(
            scaledFrame,
            dstUOff + (uOffY + y) * dstUW + uOffX,
            fitUOff + y * fitUW,
            fitUOff + y * fitUW + fitUW,
          );
        }
        // V plane
        const fitVOff = fitUOff + fitUW * fitUH;
        const dstVOff = dstUOff + uvSize;
        for (let y = 0; y < fitUH; y++) {
          fitFrame.copy(
            scaledFrame,
            dstVOff + (uOffY + y) * dstUW + uOffX,
            fitVOff + y * fitUW,
            fitVOff + y * fitUW + fitUW,
          );
        }
      }

      // Burn overlay (name, stream type, source resolution) onto the frame
      if (this.overlayEnabled) {
        renderOverlay(scaledFrame, DISPLAY_WIDTH, DISPLAY_HEIGHT, peer.peerName, peer.streamType, width, height);
      }

      // Write to ffplay stdin with backpressure guard
      const stdin = peer.ffplayProcess?.stdin;
      if (stdin?.writable && stdin.writableLength < MAX_WRITE_BUFFER) {
        // Write a copy — scaledFrame is reused for the next frame
        const frameCopy = Buffer.allocUnsafe(DISPLAY_FRAME_BYTES);
        scaledFrame.copy(frameCopy);
        stdin.write(frameCopy);
      }
    };
  }

  // ─── Send ──────────────────────────────────────────────────────────

  startCapture(videoSource: any, device?: string): void {
    if (this.capturing) return;
    this.capturing = true;
    this.videoSource = videoSource;

    const isMac = platform() === 'darwin';
    const deviceInput = device ?? '0';

    // macOS: avfoundation, Linux: v4l2
    const args = isMac
      ? [
          '-f',
          'avfoundation',
          '-framerate',
          String(CAPTURE_FPS),
          '-video_size',
          `${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`,
          '-i',
          `${deviceInput}:none`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'yuv420p',
          '-loglevel',
          'warning',
          'pipe:1',
        ]
      : [
          '-f',
          'v4l2',
          '-framerate',
          String(CAPTURE_FPS),
          '-video_size',
          `${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`,
          '-i',
          device ?? '/dev/video0',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'yuv420p',
          '-loglevel',
          'warning',
          'pipe:1',
        ];

    this.captureProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = Buffer.alloc(0);
    const MAX_BUFFER_FRAMES = 4;

    // Pre-allocate black frame for muted state (Y=0, U=128, V=128)
    const blackFrame = new Uint8ClampedArray(CAPTURE_FRAME_BYTES);
    const ySize = CAPTURE_WIDTH * CAPTURE_HEIGHT;
    // Y plane: all zeros (already)
    // U and V planes: fill with 128
    blackFrame.fill(128, ySize);

    this.captureProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Buffer overflow guard
      const bufferedFrames = Math.floor(buffer.length / CAPTURE_FRAME_BYTES);
      if (bufferedFrames > MAX_BUFFER_FRAMES) {
        const keepFrames = 1;
        buffer = buffer.subarray((bufferedFrames - keepFrames) * CAPTURE_FRAME_BYTES);
        this.onDebug?.(`Video buffer overflow, dropped ${bufferedFrames - keepFrames} frames`);
      }

      while (buffer.length >= CAPTURE_FRAME_BYTES) {
        const frameBuffer = buffer.subarray(0, CAPTURE_FRAME_BYTES);
        buffer = buffer.subarray(CAPTURE_FRAME_BYTES);

        if (this._isVideoMuted) {
          this.videoSource.onFrame({
            width: CAPTURE_WIDTH,
            height: CAPTURE_HEIGHT,
            data: blackFrame,
          });
        } else {
          // Copy frame data into a Uint8ClampedArray we own
          const frameData = new Uint8ClampedArray(CAPTURE_FRAME_BYTES);
          frameBuffer.copy(Buffer.from(frameData.buffer));
          this.videoSource.onFrame({
            width: CAPTURE_WIDTH,
            height: CAPTURE_HEIGHT,
            data: frameData,
          });
        }
      }
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

    this.onDebug?.(`Video capture started (${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}@${CAPTURE_FPS}fps)`);
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
    return this._isScreenSharing;
  }

  startScreenCapture(screenVideoSource: any, device: ScreenDevice): void {
    if (this.screenCapturing) return;
    this.screenCapturing = true;
    this._isScreenSharing = true;

    const isMac = platform() === 'darwin';

    // Use a fixed output resolution via scale+pad filter so frame size is always
    // predictable. macOS Retina displays report logical resolution via system_profiler
    // but avfoundation captures at physical pixels — so we can't trust device.width/height.
    // The scale filter handles any input → capped at 2K, and pad ensures exact output size.
    const outW = SCREEN_MAX_WIDTH;
    const outH = SCREEN_MAX_HEIGHT;
    const screenFrameBytes = outW * outH * 1.5;
    const scaleFilter = [
      `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`,
    ].join(',');

    const args = isMac
      ? [
          '-f',
          'avfoundation',
          '-capture_cursor',
          '1',
          '-framerate',
          String(SCREEN_FPS),
          '-i',
          `${device.id}:none`,
          '-vf',
          scaleFilter,
          '-r',
          String(SCREEN_FPS),
          '-f',
          'rawvideo',
          '-pix_fmt',
          'yuv420p',
          '-loglevel',
          'warning',
          'pipe:1',
        ]
      : [
          '-f',
          'x11grab',
          '-framerate',
          String(SCREEN_FPS),
          '-video_size',
          `${device.width ?? 1920}x${device.height ?? 1080}`,
          '-i',
          device.id,
          '-vf',
          scaleFilter,
          '-r',
          String(SCREEN_FPS),
          '-f',
          'rawvideo',
          '-pix_fmt',
          'yuv420p',
          '-loglevel',
          'warning',
          'pipe:1',
        ];

    this.onDebug?.(`Screen ffmpeg args: ffmpeg ${args.join(' ')}`);
    this.onDebug?.(`Screen expected frame size: ${screenFrameBytes} bytes (${outW}x${outH} I420)`);

    this.screenCaptureProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = Buffer.alloc(0);
    let screenFrameData: Uint8ClampedArray | null = null;
    let screenFrameCount = 0;
    let lastScreenLog = Date.now();
    let totalBytesReceived = 0;
    const MAX_BUFFER_FRAMES = 4;

    this.screenCaptureProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      totalBytesReceived += chunk.length;

      // Log first data and periodic stats
      if (screenFrameCount === 0 && buffer.length > 0) {
        this.onDebug?.(`Screen ffmpeg first data: ${chunk.length} bytes, buffer: ${buffer.length}/${screenFrameBytes}`);
      }

      const bufferedFrames = Math.floor(buffer.length / screenFrameBytes);
      if (bufferedFrames > MAX_BUFFER_FRAMES) {
        buffer = buffer.subarray((bufferedFrames - 1) * screenFrameBytes);
        this.onDebug?.(`Screen buffer overflow, dropped ${bufferedFrames - 1} frames`);
      }

      while (buffer.length >= screenFrameBytes) {
        const frameBuffer = buffer.subarray(0, screenFrameBytes);
        buffer = buffer.subarray(screenFrameBytes);

        // Reuse a single frame buffer to avoid ~93MB/s of GC pressure
        if (!screenFrameData) screenFrameData = new Uint8ClampedArray(screenFrameBytes);
        frameBuffer.copy(Buffer.from(screenFrameData.buffer));
        screenVideoSource.onFrame({
          width: outW,
          height: outH,
          data: screenFrameData,
        });
        screenFrameCount++;
      }

      // Log stats every 5 seconds
      const now = Date.now();
      if (now - lastScreenLog > 5000) {
        this.onDebug?.(
          `Screen capture: ${screenFrameCount} frames sent, ${Math.round(totalBytesReceived / 1024 / 1024)}MB received from ffmpeg, buffer residual: ${buffer.length} bytes`,
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

    this.screenCaptureProcess.on('error', () => {
      this.screenCapturing = false;
      this._isScreenSharing = false;
      this.onDebug?.('Screen capture failed to start');
    });

    this.screenCaptureProcess.on('close', () => {
      this.screenCapturing = false;
      this._isScreenSharing = false;
      this.onDebug?.('Screen capture stopped');
    });

    this.onDebug?.(`Screen capture started (${outW}x${outH}@${SCREEN_FPS}fps from ${device.name})`);
  }

  stopScreenCapture(): void {
    if (this.screenCaptureProcess) {
      this.screenCaptureProcess.kill();
      this.screenCaptureProcess = null;
    }
    this.screenCapturing = false;
    this._isScreenSharing = false;
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
