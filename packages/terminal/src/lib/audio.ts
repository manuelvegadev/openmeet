import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { createWriteStream, unlinkSync, type WriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import wrtc from '@roamhq/wrtc';
import type { DeviceEnvs } from './devices.js';

const { RTCAudioSink } = wrtc.nonstandard;

interface AudioSource {
  onData(data: {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
    numberOfFrames: number;
  }): void;
}

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 480; // 10ms at 48kHz
const NUM_CHANNELS = 2;
const BYTES_PER_FRAME = FRAME_SIZE * 2 * NUM_CHANNELS; // 16-bit stereo = 4 bytes per sample pair
const RMS_THRESHOLD = 800; // ~2.5% of 32768 — above this = "speaking"
const SPEAKING_HOLD_MS = 300; // Keep "speaking" for this long after audio drops

export type SpeakingCallback = (id: string, speaking: boolean) => void;

function computeRMS(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** Build spawn env: inherit process.env and merge extra overrides. */
function buildEnv(extra: Record<string, string>): Record<string, string> | undefined {
  if (Object.keys(extra).length === 0) return undefined; // inherit parent env
  return { ...(process.env as Record<string, string>), ...extra };
}

interface PeerPlayback {
  sink: InstanceType<typeof RTCAudioSink>;
  playProcess: ChildProcess | null;
  fifoPath: string | null;
  fifoStream: WriteStream | null;
  track: any;
}

export class AudioManager {
  private audioSource: AudioSource;
  private recExtra: Record<string, string>;
  private playExtra: Record<string, string>;
  private recDeviceName?: string;
  private playDeviceName?: string;
  private recProcess: ChildProcess | null = null;
  private peers = new Map<string, PeerPlayback>();
  private _isMuted = false;
  private capturing = false;
  private onSpeaking: SpeakingCallback | null = null;
  private speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private speakingStates = new Map<string, boolean>();
  private volumes = new Map<string, number>();
  private audioLevels = new Map<string, number>();
  onDebug?: (msg: string) => void;

  constructor(audioSource: AudioSource, envs: DeviceEnvs, options?: { onDebug?: (msg: string) => void }) {
    this.audioSource = audioSource;
    this.recExtra = envs.recExtra;
    this.playExtra = envs.playExtra;
    this.recDeviceName = envs.recDeviceName;
    this.playDeviceName = envs.playDeviceName;
    this.onDebug = options?.onDebug;
  }

  setSpeakingCallback(cb: SpeakingCallback): void {
    this.onSpeaking = cb;
  }

  private updateSpeaking(id: string, rms: number): void {
    const isSpeaking = rms > RMS_THRESHOLD;
    const wasSpeaking = this.speakingStates.get(id) ?? false;

    if (isSpeaking) {
      const timer = this.speakingTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.speakingTimers.delete(id);
      }
      if (!wasSpeaking) {
        this.speakingStates.set(id, true);
        this.onSpeaking?.(id, true);
      }
    } else if (wasSpeaking && !this.speakingTimers.has(id)) {
      const timer = setTimeout(() => {
        this.speakingTimers.delete(id);
        this.speakingStates.set(id, false);
        this.onSpeaking?.(id, false);
      }, SPEAKING_HOLD_MS);
      this.speakingTimers.set(id, timer);
    }
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  setVolume(peerId: string, volume: number): void {
    this.volumes.set(peerId, Math.max(0, Math.min(1, volume)));
  }

  getVolume(peerId: string): number {
    return this.volumes.get(peerId) ?? 1;
  }

  getAudioLevel(peerId: string): number {
    return this.audioLevels.get(peerId) ?? 0;
  }

  getAllAudioLevels(): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [peerId, level] of this.audioLevels) {
      levels[peerId] = level;
    }
    return levels;
  }

  startCapture(): void {
    if (this.capturing) return;
    this.capturing = true;
    this.onDebug?.('Audio capture started (stereo 48kHz)');

    // macOS: sox -t coreaudio "DeviceName" for per-device selection
    // Linux: rec with PULSE_SOURCE env var
    const cmd = this.recDeviceName ? 'sox' : 'rec';
    const args = this.recDeviceName
      ? [
          '-q',
          '-t',
          'coreaudio',
          this.recDeviceName,
          '-t',
          'raw',
          '-b',
          '16',
          '-e',
          'signed-integer',
          '-c',
          String(NUM_CHANNELS),
          '-r',
          String(SAMPLE_RATE),
          '-',
        ]
      : [
          '-q',
          '-t',
          'raw',
          '-b',
          '16',
          '-e',
          'signed-integer',
          '-c',
          String(NUM_CHANNELS),
          '-r',
          String(SAMPLE_RATE),
          '-',
        ];

    this.recProcess = spawn(cmd, args, {
      env: buildEnv(this.recExtra),
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let buffer = Buffer.alloc(0);
    let captureStartMs = Date.now();
    let framesPushed = 0;
    const MAX_BUFFER_FRAMES = 8; // 80ms — drop stale audio beyond this
    const MAX_DRIFT_MS = 50; // Skip pushing if we're >50ms ahead of real-time

    this.recProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Guard against event loop stalls: when the event loop is blocked (TUI renders,
      // WS processing), sox continues writing to the pipe buffer. When the loop resumes,
      // we read a burst of audio. Without this check, all frames would be pushed to
      // RTCAudioSource instantly (faster than real-time), causing the WebRTC engine to
      // queue them — delay that never recovers and compounds over time.
      const bufferedFrames = Math.floor(buffer.length / BYTES_PER_FRAME);
      if (bufferedFrames > MAX_BUFFER_FRAMES) {
        const keepFrames = 2; // Keep most recent ~20ms
        buffer = buffer.subarray((bufferedFrames - keepFrames) * BYTES_PER_FRAME);
        // Reset drift baseline since we jumped ahead in the audio stream
        captureStartMs = Date.now();
        framesPushed = 0;
        this.onDebug?.(`Audio buffer overflow, dropped ${bufferedFrames - keepFrames} frames`);
      }

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameBuffer = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);

        // RTCAudioSource.onData requires samples.buffer.byteLength to match exactly.
        // Buffer.from() uses Node's pool allocator (8KB shared ArrayBuffer), so we
        // must copy into a dedicated Int16Array with its own ArrayBuffer.
        const realSamples = new Int16Array(FRAME_SIZE * NUM_CHANNELS);
        for (let i = 0; i < FRAME_SIZE * NUM_CHANNELS; i++) {
          realSamples[i] = frameBuffer.readInt16LE(i * 2);
        }

        const localRms = computeRMS(realSamples);
        this.updateSpeaking('__local__', localRms);
        this.audioLevels.set('__local__', localRms);

        // Clock drift guard: if hardware capture clock runs slightly faster than
        // WebRTC's consumption rate, frames accumulate in the internal buffer.
        // Skip pushing when we're ahead of real-time to prevent slow drift buildup.
        framesPushed++;
        const audioMs = ((framesPushed * FRAME_SIZE) / SAMPLE_RATE) * 1000;
        const elapsedMs = Date.now() - captureStartMs;
        if (audioMs - elapsedMs > MAX_DRIFT_MS) {
          this.onDebug?.('Audio drift guard: skipping frame');
          continue;
        }

        const samples = this._isMuted ? new Int16Array(FRAME_SIZE * NUM_CHANNELS) : realSamples;

        this.audioSource.onData({
          samples,
          sampleRate: SAMPLE_RATE,
          bitsPerSample: 16,
          channelCount: NUM_CHANNELS,
          numberOfFrames: FRAME_SIZE,
        });
      }
    });

    this.recProcess.on('error', () => {
      this.capturing = false;
    });

    this.recProcess.on('close', () => {
      this.capturing = false;
      this.onDebug?.('Audio capture stopped');
    });
  }

  stopCapture(): void {
    if (this.recProcess) {
      this.recProcess.kill();
      this.recProcess = null;
    }
    this.capturing = false;
  }

  mute(): void {
    this._isMuted = true;
  }

  unmute(): void {
    this._isMuted = false;
  }

  toggleMute(): boolean {
    this._isMuted = !this._isMuted;
    return this._isMuted;
  }

  private spawnPlay(peerId: string, peer: PeerPlayback): void {
    // Use a FIFO (named pipe) instead of stdin piping. Node.js spawn() creates
    // non-blocking pipes; sox interprets EAGAIN (no data yet) as EOF and exits.
    // FIFOs use blocking reads, so sox correctly waits for streaming data.
    const fifoPath = join(tmpdir(), `openmeet-audio-${peerId}-${Date.now()}`);
    try {
      execSync(`mkfifo "${fifoPath}"`);
    } catch {
      return;
    }
    peer.fifoPath = fifoPath;

    // Always play as stereo — mono input is upmixed in wireSink before writing
    const channels = String(NUM_CHANNELS);
    const rate = String(SAMPLE_RATE);

    // macOS: sox ... -t coreaudio "DeviceName" for per-device selection
    // Linux: play with PULSE_SINK env var
    const cmd = this.playDeviceName ? 'sox' : 'play';
    const args = this.playDeviceName
      ? [
          '-q',
          '-t',
          'raw',
          '-b',
          '16',
          '-e',
          'signed-integer',
          '-c',
          channels,
          '-r',
          rate,
          fifoPath,
          '-t',
          'coreaudio',
          this.playDeviceName,
        ]
      : ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', channels, '-r', rate, fifoPath];

    const playProcess = spawn(cmd, args, {
      env: buildEnv(this.playExtra),
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    peer.playProcess = playProcess;
    this.onDebug?.(`Audio playback started for peer ${peerId.slice(0, 6)} (stereo)`);

    // Open FIFO for writing — createWriteStream queues writes until the fd is ready.
    // sox opens the FIFO for reading, unblocking both ends.
    peer.fifoStream = createWriteStream(fifoPath);
    peer.fifoStream.on('error', () => {
      // FIFO closed (sox exited) — ignore write errors
    });

    playProcess.on('error', () => {});

    playProcess.on('close', () => {
      // Clean up FIFO file
      if (peer.fifoPath) {
        try {
          unlinkSync(peer.fifoPath);
        } catch {
          // Already removed
        }
        peer.fifoPath = null;
      }
    });
  }

  private wireSink(peerId: string, peer: PeerPlayback): void {
    let spawned = false;

    peer.sink.ondata = (data: any) => {
      // Copy samples into a fresh Int16Array we own (the native addon may reuse
      // the underlying ArrayBuffer between callbacks).
      const samplesCopy = new Int16Array(data.samples.length);
      samplesCopy.set(data.samples);

      // Compute level on original samples (before volume scaling)
      const rms = computeRMS(samplesCopy);
      this.updateSpeaking(peerId, rms);
      this.audioLevels.set(peerId, rms);

      // Apply per-peer volume scaling
      const vol = this.volumes.get(peerId) ?? 1;
      if (vol !== 1) {
        for (let i = 0; i < samplesCopy.length; i++) {
          samplesCopy[i] = Math.max(-32768, Math.min(32767, Math.round(samplesCopy[i] * vol)));
        }
      }

      // Detect mono input: if samples.length === numberOfFrames, it's mono.
      // Upmix to stereo (duplicate each sample to L+R) for the stereo sox playback.
      let outputSamples: Int16Array;
      if (data.samples.length === data.numberOfFrames) {
        // Mono → stereo upmix
        outputSamples = new Int16Array(data.numberOfFrames * NUM_CHANNELS);
        for (let i = 0; i < data.numberOfFrames; i++) {
          outputSamples[i * 2] = samplesCopy[i];
          outputSamples[i * 2 + 1] = samplesCopy[i];
        }
      } else {
        outputSamples = samplesCopy;
      }

      // Buffer *view* of our copy's raw bytes. IMPORTANT: Buffer.from(TypedArray)
      // truncates each element to a single byte — we must use the ArrayBuffer
      // overload to get the actual 16-bit PCM bytes.
      const buf = Buffer.from(outputSamples.buffer, outputSamples.byteOffset, outputSamples.byteLength);

      // Lazy-spawn sox play with actual data format from RTCAudioSink
      if (!spawned) {
        spawned = true;
        this.spawnPlay(peerId, peer);
      }

      // Guard against playback buffer growth: if the event loop was blocked,
      // multiple ondata callbacks fire rapidly, writing bursts to the FIFO.
      // The OS pipe buffer (64KB) absorbs the burst but adds latency that
      // never recovers. Skip writes when Node.js buffer exceeds threshold.
      const MAX_PLAYBACK_BUFFER = SAMPLE_RATE * 2 * NUM_CHANNELS * 0.15; // 150ms of stereo 16-bit audio
      if (peer.fifoStream?.writable && peer.fifoStream.writableLength < MAX_PLAYBACK_BUFFER) {
        peer.fifoStream.write(buf);
      }
    };
  }

  addRemotePeer(peerId: string, track: any): void {
    this.removeRemotePeer(peerId);

    try {
      const sink = new RTCAudioSink(track);
      const peer: PeerPlayback = { sink, playProcess: null, fifoPath: null, fifoStream: null, track };
      this.peers.set(peerId, peer);
      this.wireSink(peerId, peer);
      this.onDebug?.(`Audio peer added: ${peerId.slice(0, 6)}`);
    } catch {
      // RTCAudioSink setup failed — non-fatal
    }
  }

  removeRemotePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.sink.stop();
      if (peer.fifoStream) {
        peer.fifoStream.end();
        peer.fifoStream = null;
      }
      if (peer.playProcess) {
        peer.playProcess.kill();
      }
      if (peer.fifoPath) {
        try {
          unlinkSync(peer.fifoPath);
        } catch {
          // Already removed
        }
        peer.fifoPath = null;
      }
      this.peers.delete(peerId);
      this.onDebug?.(`Audio peer removed: ${peerId.slice(0, 6)}`);
    }

    const timer = this.speakingTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.speakingTimers.delete(peerId);
    this.speakingStates.delete(peerId);
    this.volumes.delete(peerId);
    this.audioLevels.delete(peerId);
  }

  updateDevices(envs: DeviceEnvs): void {
    this.recExtra = envs.recExtra;
    this.playExtra = envs.playExtra;
    this.recDeviceName = envs.recDeviceName;
    this.playDeviceName = envs.playDeviceName;

    // Restart mic capture
    if (this.capturing) {
      this.stopCapture();
      this.startCapture();
    }

    // Restart all remote playback processes with new device env
    for (const [peerId, peer] of this.peers) {
      if (peer.fifoStream) {
        peer.fifoStream.end();
        peer.fifoStream = null;
      }
      if (peer.playProcess) {
        peer.playProcess.kill();
        peer.playProcess = null;
      }
      if (peer.fifoPath) {
        try {
          unlinkSync(peer.fifoPath);
        } catch {
          // Already removed
        }
        peer.fifoPath = null;
      }

      // Re-create sink to trigger lazy-spawn with new env
      peer.sink.stop();
      peer.sink = new RTCAudioSink(peer.track);
      this.wireSink(peerId, peer);
    }
  }

  shutdown(): void {
    this.stopCapture();
    for (const peerId of [...this.peers.keys()]) {
      this.removeRemotePeer(peerId);
    }
    const localTimer = this.speakingTimers.get('__local__');
    if (localTimer) clearTimeout(localTimer);
    this.speakingTimers.clear();
    this.speakingStates.clear();
    this.volumes.clear();
    this.audioLevels.clear();
  }
}
