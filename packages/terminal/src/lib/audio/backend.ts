import { getPlatformSupport } from '../platform.js';

export interface AudioDevice {
  /** Stable identifier persisted in settings (device name for every backend). */
  id: string;
  name: string;
  type: 'input' | 'output';
  isDefault?: boolean;
}

export interface AudioDeviceList {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

/** Devices chosen by the user. `undefined` means the system default. */
export interface AudioDeviceSelection {
  input?: AudioDevice;
  output?: AudioDevice;
}

export type AudioBackendName = 'sox' | 'rtaudio';
export type AudioBackendPreference = 'auto' | AudioBackendName;

export interface AudioStreamCallbacks {
  /**
   * One 10 ms frame of interleaved stereo Int16 PCM (480 × 2 samples), clocked by the
   * capture device. The array is owned by the callee and may be reused by the backend
   * after the call returns.
   */
  onCapture: (samples: Int16Array) => void;
  /**
   * Called when the backend needs the next 10 ms output frame. The callee fills `out`
   * (480 × 2 interleaved Int16) — silence if there is nothing to play.
   */
  onPlayback: (out: Int16Array) => void;
  /** A device or driver error. The stream may have stopped. */
  onError?: (message: string) => void;
  onDebug?: (message: string) => void;
}

/**
 * Audio device I/O. A backend owns the capture and playback streams and clocks the
 * AudioManager; everything above it (WebRTC, mixing, processing) is backend-agnostic.
 * `start()` may be called again after `stop()` (the manager restarts on device errors).
 */
export interface AudioBackend {
  readonly name: AudioBackendName;
  listDevices(): Promise<AudioDeviceList>;
  /** Open capture + playback on the selected devices. Resolves once the stream is running. */
  start(selection: AudioDeviceSelection, callbacks: AudioStreamCallbacks): Promise<void>;
  stop(): void;
}

let activeBackendName: AudioBackendName | null = null;

/** Pick the backend for this platform unless the user forced one. */
export function resolveBackendName(preference: AudioBackendPreference): AudioBackendName {
  return preference === 'auto' ? getPlatformSupport().defaultAudioBackend : preference;
}

/** Validate a `--audio-backend` flag value; returns null when it is not a backend name. */
export function parseBackendFlag(value: string | undefined): AudioBackendPreference | null {
  if (value === undefined) return 'auto';
  return value === 'sox' || value === 'rtaudio' ? value : null;
}

/** Set once at startup from the CLI flag; read by everything that needs a backend. */
export function setActiveBackendName(name: AudioBackendName): void {
  activeBackendName = name;
}

export function getActiveBackendName(): AudioBackendName {
  return activeBackendName ?? resolveBackendName('auto');
}

export async function createAudioBackend(name: AudioBackendName = getActiveBackendName()): Promise<AudioBackend> {
  if (name === 'rtaudio') {
    const { RtAudioBackend } = await import('./rtaudio-backend.js');
    return new RtAudioBackend();
  }
  const { SoxBackend } = await import('./sox-backend.js');
  return new SoxBackend();
}
