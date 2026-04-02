import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.config', 'openmeet');
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
}

const DEFAULTS: AppSettings = {
  audioInputId: null,
  audioOutputId: null,
  videoDeviceId: null,
  devicesConfigured: false,
  videoOverlay: false,
};

let cache: AppSettings | null = null;

function readFromDisk(): AppSettings {
  try {
    const raw = readFileSync(SETTINGS_FILE, 'utf-8');
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
