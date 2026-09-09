import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AudioBackendPreference } from './audio/backend.js';
import type { InputChannelPolicy } from './audio/channels.js';
import { DEFAULT_AUDIO_KBPS } from './sdp.js';
import type { RenderPausePolicy } from './window-state.js';

/** ~/.config/openmeet on macOS/Linux, %APPDATA%\openmeet on Windows. */
export const CONFIG_DIR =
  platform() === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'openmeet')
    : join(homedir(), '.config', 'openmeet');
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');

// Legacy device files (pre-settings.json)
const LEGACY_INPUT_FILE = join(CONFIG_DIR, 'audio-input');
const LEGACY_OUTPUT_FILE = join(CONFIG_DIR, 'audio-output');

export interface AppSettings {
  audioInputId: string | null;
  audioOutputId: string | null;
  videoDeviceId: string | null;
  devicesConfigured: boolean;
  videoOverlay: boolean;
  /** Audio I/O backend: 'auto' picks the platform default (see lib/platform.ts). */
  audioBackend: AudioBackendPreference;
  /** How the captured pair becomes the sent stereo frame (see lib/audio/channels.ts). */
  audioInputChannels: InputChannelPolicy;
  /** Capture gain in dB applied before sending (0 = as captured). */
  audioInputGainDb: number;
  /** Opus ceiling in kbps for what we send. Bounds our encoder via the peer's description. */
  audioSendKbps: number;
  /** Opus ceiling in kbps for what peers send us. Declared in our own description. */
  audioReceiveKbps: number;
  /** RNNoise on the capture path. Opt-in: it is a taste call, and it costs ~0.2 ms a frame. */
  noiseSuppression: boolean;
  /** Pause TUI rendering when the window is minimized (default) or unfocused, or never. */
  pauseRendering: RenderPausePolicy;
}

const DEFAULTS: AppSettings = {
  audioInputId: null,
  audioOutputId: null,
  videoDeviceId: null,
  devicesConfigured: false,
  videoOverlay: false,
  audioBackend: 'auto',
  audioInputChannels: 'auto',
  audioInputGainDb: 0,
  audioSendKbps: DEFAULT_AUDIO_KBPS,
  audioReceiveKbps: DEFAULT_AUDIO_KBPS,
  noiseSuppression: false,
  pauseRendering: 'minimized',
};

let cache: AppSettings | null = null;

function readFromDisk(): AppSettings {
  try {
    // Strip a UTF-8 BOM: JSON.parse throws on it, and the catch below would then silently
    // hand back DEFAULTS — every saved setting lost with nothing said. Windows puts one there
    // easily (Notepad, and PowerShell's `Set-Content -Encoding UTF8`), which is how this was
    // found. `wt-profile.cjs` already had to do the same for Windows Terminal's own file.
    const raw = readFileSync(SETTINGS_FILE, 'utf-8').replace(/^\uFEFF/, '');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // No settings.json — try migrating from legacy device files
    const settings = { ...DEFAULTS };

    try {
      if (existsSync(LEGACY_INPUT_FILE) || existsSync(LEGACY_OUTPUT_FILE)) {
        settings.devicesConfigured = true;
        try {
          settings.audioInputId = readFileSync(LEGACY_INPUT_FILE, 'utf-8').trim() || null;
        } catch {}
        try {
          settings.audioOutputId = readFileSync(LEGACY_OUTPUT_FILE, 'utf-8').trim() || null;
        } catch {}
      }
    } catch {}

    return settings;
  }
}

export function loadSettings(): AppSettings {
  if (cache) return cache;
  cache = readFromDisk();
  return cache;
}

export function saveSettings(update: Partial<AppSettings>): void {
  const current = loadSettings();
  cache = { ...current, ...update };
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // Can't persist — non-fatal
  }
}
