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
const BYTES_PER_FRAME = FRAME_SIZE * 2; // 16-bit = 2 bytes per sample
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

  constructor(audioSource: AudioSource, envs: DeviceEnvs) {
    this.audioSource = audioSource;
    this.recExtra = envs.recExtra;
    this.playExtra = envs.playExtra;
    this.recDeviceName = envs.recDeviceName;
    this.playDeviceName = envs.playDeviceName;
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
          '1',
          '-r',
          String(SAMPLE_RATE),
          '-',
        ]
      : ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', String(SAMPLE_RATE), '-'];

    this.recProcess = spawn(cmd, args, {
      env: buildEnv(this.recExtra),
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let buffer = Buffer.alloc(0);

    this.recProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= BYTES_PER_FRAME) {
        const frameBuffer = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);

        // RTCAudioSource.onData requires samples.buffer.byteLength === exactly 960.
        // Buffer.from() uses Node's pool allocator (8KB shared ArrayBuffer), so we
        // must copy into a dedicated Int16Array with its own ArrayBuffer.
        const realSamples = new Int16Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) {
          realSamples[i] = frameBuffer.readInt16LE(i * 2);
        }

        const localRms = computeRMS(realSamples);
        this.updateSpeaking('__local__', localRms);
        this.audioLevels.set('__local__', localRms);

        const samples = this._isMuted ? new Int16Array(FRAME_SIZE) : realSamples;

        this.audioSource.onData({
          samples,
          sampleRate: SAMPLE_RATE,
          bitsPerSample: 16,
          channelCount: 1,
          numberOfFrames: FRAME_SIZE,
        });
      }
    });

    this.recProcess.on('error', () => {
      this.capturing = false;
    });

    this.recProcess.on('close', () => {
      this.capturing = false;
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

  private spawnPlay(peerId: string, peer: PeerPlayback, channels: string, rate: string): void {
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

      // Buffer *view* of our copy's raw bytes. IMPORTANT: Buffer.from(TypedArray)
      // truncates each element to a single byte — we must use the ArrayBuffer
      // overload to get the actual 16-bit PCM bytes.
      const buf = Buffer.from(samplesCopy.buffer, samplesCopy.byteOffset, samplesCopy.byteLength);

      // Lazy-spawn sox play with actual data format from RTCAudioSink
      if (!spawned) {
        spawned = true;
        // @roamhq/wrtc RTCAudioSink misreports sampleRate (e.g. 16000) while
        // delivering 48kHz samples. Force 48kHz mono to match WebRTC Opus decode.
        this.spawnPlay(peerId, peer, '1', String(SAMPLE_RATE));
      }

      if (peer.fifoStream?.writable) {
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
