import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AudioBackendPreference } from './audio/backend.js';
import type { InputChannelPolicy } from './audio/channels.js';
import { type Identity, isNameColor } from './identity.js';
import { DEFAULT_AUDIO_KBPS, DEFAULT_SCREEN_KBPS } from './sdp.js';
import type { UpdatePolicy } from './update.js';
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
  /** Your name in a room, up to 8 cells (see lib/identity.ts). Null until the first start sets it. */
  name: string | null;
  /** The colour your name is drawn in, `#rrggbb` from `NAME_PALETTE`. */
  color: string | null;
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
  /** Screen-share ceiling in kbps for what we send, per peer, at 1080p (more for wider shares). */
  screenSendKbps: number;
  /** Screen-share ceiling in kbps we ask each peer to respect towards us. */
  screenReceiveKbps: number;
  /** RNNoise on the capture path. Opt-in: it is a taste call, and it costs ~0.2 ms a frame. */
  noiseSuppression: boolean;
  /**
   * Transmit only while the voice gate is open (see `audio/voice-gate.ts`). On by default:
   * it is what keeps a silent participant from costing every peer an encode and a decode.
   * Off sends continuously, which is what the app did before.
   */
  voiceGate: boolean;
  /** Pause TUI rendering when the window is minimized (default) or unfocused, or never. */
  pauseRendering: RenderPausePolicy;
  /** auto installs on the way out, notify only says so, off does not even ask the registry. */
  autoUpdate: UpdatePolicy;
  /** When we last asked the registry, so a launch does not (see lib/update.ts). */
  lastUpdateCheck: number;
  /** The newest version the registry has mentioned, cached with the timestamp above. */
  latestSeen: string | null;
  /** The version that ran last, which is how a silent update gets to announce itself once. */
  lastRunVersion: string | null;
}

const DEFAULTS: AppSettings = {
  name: null,
  color: null,
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
  screenSendKbps: DEFAULT_SCREEN_KBPS,
  screenReceiveKbps: DEFAULT_SCREEN_KBPS,
  noiseSuppression: false,
  voiceGate: true,
  pauseRendering: 'minimized',
  autoUpdate: 'auto',
  lastUpdateCheck: 0,
  latestSeen: null,
  lastRunVersion: null,
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

/** The saved identity, or null while the first start has not set one (see lib/identity.ts). */
export function loadIdentity(): Identity | null {
  const { name, color } = loadSettings();
  if (!name || !isNameColor(color)) return null;
  return { name, color };
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
