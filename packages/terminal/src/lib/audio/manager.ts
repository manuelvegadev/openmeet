import wrtc from '@roamhq/wrtc';
import type { AudioBackend, AudioDeviceSelection } from './backend.js';
import { createAudioBackend } from './backend.js';
import { CHANNELS, computeRMS, FRAME_SAMPLES, SAMPLE_RATE, SPEAKING_RMS_THRESHOLD } from './constants.js';
import { FrameMixer, PeerPlayoutBuffer } from './mixer.js';
import { type CaptureProcessor, CaptureProcessorChain } from './processors.js';

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

const SPEAKING_HOLD_MS = 300;
const LOCAL_ID = '__local__';
const RESTART_DELAY_MS = 750;
const MAX_RESTARTS = 3;

export type SpeakingCallback = (id: string, speaking: boolean) => void;

interface RemotePeer {
  sink: InstanceType<typeof RTCAudioSink>;
  track: any;
  buffer: PeerPlayoutBuffer;
  volume: number;
}

/**
 * Backend-agnostic audio pipeline:
 *
 *   device ──▶ backend.onCapture ──▶ [mute] ──▶ processors ──▶ RTCAudioSource
 *   RTCAudioSink (per peer) ──▶ PeerPlayoutBuffer ──▶ FrameMixer ──▶ backend.onPlayback ──▶ device
 *
 * The backend clocks both directions; this class never schedules audio itself.
 */
export class AudioManager {
  private readonly audioSource: AudioSource;
  private selection: AudioDeviceSelection;
  private backend: AudioBackend | null = null;
  private readonly peers = new Map<string, RemotePeer>();
  private readonly mixer = new FrameMixer();
  private readonly processors = new CaptureProcessorChain();
  private _isMuted = false;
  private warnedProcessorRate = false;
  private started = false;
  private opening = false;
  private restarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private onSpeaking: SpeakingCallback | null = null;
  private readonly speakingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly speakingStates = new Map<string, boolean>();
  private readonly audioLevels = new Map<string, number>();
  private readonly silence = new Int16Array(FRAME_SAMPLES);
  private _readyResolve: (() => void) | null = null;
  private readonly _ready: Promise<void>;
  private _isReady = false;
  onDebug?: (msg: string) => void;

  constructor(
    audioSource: AudioSource,
    selection: AudioDeviceSelection,
    options?: { onDebug?: (msg: string) => void },
  ) {
    this.audioSource = audioSource;
    this.selection = selection;
    this.onDebug = options?.onDebug;
    this._ready = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /** Resolves when the first capture frame has been pushed to WebRTC. */
  get ready(): Promise<void> {
    return this._ready;
  }

  setSpeakingCallback(cb: SpeakingCallback): void {
    this.onSpeaking = cb;
  }

  // ─── Capture processing hook ─────────────────────────────────────────

  /** Insert a processor (e.g. noise suppression) into the capture path. Safe while running. */
  addCaptureProcessor(processor: CaptureProcessor): void {
    this.processors.add(processor);
    this.onDebug?.(`Capture processor added: ${processor.name}`);
  }

  removeCaptureProcessor(name: string): void {
    this.processors.remove(name);
    this.onDebug?.(`Capture processor removed: ${name}`);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /** Open the audio devices and start streaming both directions. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.openBackend();
  }

  stop(): void {
    this.started = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.backend?.stop();
    this.backend = null;
  }

  private async openBackend(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      const backend = this.backend ?? (await createAudioBackend());
      this.backend = backend;
      await backend.start(this.selection, {
        onCapture: (samples, sampleRate) => this.handleCapture(samples, sampleRate),
        onPlayback: (out) => this.handlePlayback(out),
        onError: (msg) => this.handleBackendError(msg),
        onDebug: this.onDebug ? (msg) => this.onDebug?.(msg) : undefined,
      });
      this.onDebug?.(`Audio started (${backend.name}, ${CHANNELS}ch ${SAMPLE_RATE / 1000}kHz)`);
    } catch (err) {
      this.opening = false;
      this.handleBackendError(err instanceof Error ? err.message : String(err));
      return;
    }
    this.opening = false;
  }

  private handleBackendError(message: string): void {
    this.onDebug?.(`Audio error: ${message}`);
    if (!this.started) return;
    // One restart at a time: several errors from the same failure must not fan out into
    // several concurrent streams on the same devices.
    if (this.restartTimer) return;
    if (this.restarts >= MAX_RESTARTS) {
      this.onDebug?.('Audio: giving up after repeated failures');
      return;
    }
    this.restarts++;
    // Device unplugged or driver hiccup: reopen, falling back to system defaults.
    const useDefaults = this.restarts > 1;
    if (useDefaults) this.selection = {};
    this.onDebug?.(`Audio restart ${this.restarts}/${MAX_RESTARTS}${useDefaults ? ' with default devices' : ''}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.started) return;
      this.backend?.stop();
      void this.openBackend();
    }, RESTART_DELAY_MS);
  }

  async updateDevices(selection: AudioDeviceSelection): Promise<void> {
    this.selection = selection;
    if (!this.started) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restarts = 0;
    this.backend?.stop();
    await this.openBackend();
  }

  shutdown(): void {
    this.stop();
    for (const peerId of [...this.peers.keys()]) this.removeRemotePeer(peerId);
    const localTimer = this.speakingTimers.get(LOCAL_ID);
    if (localTimer) clearTimeout(localTimer);
    this.speakingTimers.clear();
    this.speakingStates.clear();
    this.audioLevels.clear();
    this.processors.dispose();
  }

  // ─── Capture path ────────────────────────────────────────────────────

  private handleCapture(samples: Int16Array, sampleRate: number): void {
    const rms = computeRMS(samples);
    this.updateSpeaking(LOCAL_ID, rms);
    this.audioLevels.set(LOCAL_ID, rms);

    let frame: Int16Array;
    if (this._isMuted) {
      frame = samples.length === FRAME_SAMPLES ? this.silence : new Int16Array(samples.length);
    } else if (this.processors.isEmpty) {
      frame = samples;
    } else if (sampleRate === SAMPLE_RATE) {
      frame = this.processors.process(samples);
    } else {
      // Processors are written for 48 kHz frames; a native-rate capture bypasses them.
      if (!this.warnedProcessorRate) {
        this.warnedProcessorRate = true;
        this.onDebug?.(`Capture at ${sampleRate} Hz: capture processors skipped`);
      }
      frame = samples;
    }

    // RTCAudioSource.onData requires an ArrayBuffer whose byteLength matches the frame
    // exactly, so hand it a dedicated copy rather than a view into a reused buffer.
    // libwebrtc resamples to the encoder rate when sampleRate is not 48 kHz.
    const owned = new Int16Array(frame.length);
    owned.set(frame);
    this.audioSource.onData({
      samples: owned,
      sampleRate,
      bitsPerSample: 16,
      channelCount: CHANNELS,
      numberOfFrames: frame.length / CHANNELS,
    });

    if (!this._isReady) {
      this._isReady = true;
      this._readyResolve?.();
      this._readyResolve = null;
      this.onDebug?.('Audio capture ready (first frame)');
    }
    // Frames flowing means the last (re)start worked; refill the restart budget.
    if (this.restarts > 0 && !this.restartTimer) this.restarts = 0;
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  toggleMute(): boolean {
    this._isMuted = !this._isMuted;
    return this._isMuted;
  }

  // ─── Playback path ───────────────────────────────────────────────────

  private handlePlayback(out: Int16Array): void {
    if (this.peers.size === 0) {
      out.fill(0);
      return;
    }
    this.mixer.mix(out, this.peers.values());
  }

  addRemotePeer(peerId: string, track: any): void {
    this.removeRemotePeer(peerId);
    try {
      const sink = new RTCAudioSink(track);
      const peer: RemotePeer = {
        sink,
        track,
        buffer: new PeerPlayoutBuffer(),
        volume: 1,
      };
      this.peers.set(peerId, peer);
      sink.ondata = (data: any) => {
        const samples: Int16Array = data.samples;
        const rms = computeRMS(samples);
        this.updateSpeaking(peerId, rms);
        this.audioLevels.set(peerId, rms);
        // The addon may reuse the underlying buffer; the ring copies on push.
        peer.buffer.push(samples, data.numberOfFrames);
      };
      this.onDebug?.(`Audio peer added: ${peerId.slice(0, 6)}`);
    } catch {
      // RTCAudioSink setup failed — non-fatal
    }
  }

  removeRemotePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.sink.stop();
      this.peers.delete(peerId);
      if (peer.buffer.dropped || peer.buffer.underruns) {
        this.onDebug?.(
          `Audio peer ${peerId.slice(0, 6)} playout: ${peer.buffer.dropped} dropped, ${peer.buffer.underruns} underruns`,
        );
      }
      this.onDebug?.(`Audio peer removed: ${peerId.slice(0, 6)}`);
    }
    const timer = this.speakingTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.speakingTimers.delete(peerId);
    this.speakingStates.delete(peerId);
    this.audioLevels.delete(peerId);
  }

  /** Clamps to 0..1 and returns the value applied (1 when the peer is unknown). */
  setVolume(peerId: string, volume: number): number {
    const clamped = Math.max(0, Math.min(1, volume));
    const peer = this.peers.get(peerId);
    if (peer) peer.volume = clamped;
    return peer ? clamped : 1;
  }

  // ─── Levels / speaking ───────────────────────────────────────────────

  getAllAudioLevels(): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [peerId, level] of this.audioLevels) levels[peerId] = level;
    return levels;
  }

  private updateSpeaking(id: string, rms: number): void {
    const isSpeaking = rms > SPEAKING_RMS_THRESHOLD;
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
}
