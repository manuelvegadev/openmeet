import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.config', 'openmeet');
const INPUT_DEVICE_FILE = join(CONFIG_DIR, 'audio-input');
const OUTPUT_DEVICE_FILE = join(CONFIG_DIR, 'audio-output');

export interface AudioDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
}

export async function listAudioDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  const os = platform();

  if (os === 'darwin') {
    return listMacOSDevices();
  }
  if (os === 'linux') {
    return listLinuxDevices();
  }

  return { inputs: [], outputs: [] };
}

function listMacOSDevices(): { inputs: AudioDevice[]; outputs: AudioDevice[] } {
  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];

  try {
    const json = execSync('system_profiler SPAudioDataType -json', { encoding: 'utf-8' });
    const data = JSON.parse(json);
    const sections = data.SPAudioDataType ?? [];

    for (const section of sections) {
      const devices = section._items ?? [];
      for (const device of devices) {
        const name = device._name;
        if (!name) continue;

        if (device.coreaudio_device_input) {
          inputs.push({ id: name, name, type: 'input' });
        }
        if (device.coreaudio_device_output) {
          outputs.push({ id: name, name, type: 'output' });
        }
      }
    }
  } catch {
    // system_profiler not available
  }

  return { inputs, outputs };
}

function listLinuxDevices(): { inputs: AudioDevice[]; outputs: AudioDevice[] } {
  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];

  try {
    const sourcesRaw = execSync('pactl list sources short', { encoding: 'utf-8' });
    for (const line of sourcesRaw.trim().split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const name = parts[1];
        inputs.push({ id: name, name, type: 'input' });
      }
    }
  } catch {
    // pactl not available
  }

  try {
    const sinksRaw = execSync('pactl list sinks short', { encoding: 'utf-8' });
    for (const line of sinksRaw.trim().split('\n')) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const name = parts[1];
        outputs.push({ id: name, name, type: 'output' });
      }
    }
  } catch {
    // pactl not available
  }

  return { inputs, outputs };
}

export function getSavedInputDevice(): string | null {
  try {
    const val = readFileSync(INPUT_DEVICE_FILE, 'utf-8').trim();
    return val || null;
  } catch {
    return null;
  }
}

export function getSavedOutputDevice(): string | null {
  try {
    const val = readFileSync(OUTPUT_DEVICE_FILE, 'utf-8').trim();
    return val || null;
  } catch {
    return null;
  }
}

export function saveDevicePreferences(input?: AudioDevice, output?: AudioDevice): void {
  try {
    mkdirSync(dirname(INPUT_DEVICE_FILE), { recursive: true });
    writeFileSync(INPUT_DEVICE_FILE, input?.id ?? '', 'utf-8');
    writeFileSync(OUTPUT_DEVICE_FILE, output?.id ?? '', 'utf-8');
  } catch {
    // Can't persist
  }
}

/** Only the extra env vars to override — merged with process.env at spawn time. */
export interface DeviceEnvs {
  recExtra: Record<string, string>;
  playExtra: Record<string, string>;
  /** macOS: CoreAudio device name for sox -t coreaudio "name" recording */
  recDeviceName?: string;
  /** macOS: CoreAudio device name for sox -t coreaudio "name" playback */
  playDeviceName?: string;
}

export function getDeviceEnv(input?: AudioDevice, output?: AudioDevice): DeviceEnvs {
  const os = platform();

  const recExtra: Record<string, string> = {};
  const playExtra: Record<string, string> = {};
  let recDeviceName: string | undefined;
  let playDeviceName: string | undefined;

  if (os === 'darwin') {
    // macOS: use sox -t coreaudio "DeviceName" syntax (AUDIODEV env var is broken)
    if (input) recDeviceName = input.name;
    if (output) playDeviceName = output.name;
  } else if (os === 'linux') {
    // Linux PulseAudio supports per-process device routing via env vars
    if (input) recExtra.PULSE_SOURCE = input.id;
    if (output) playExtra.PULSE_SINK = output.id;
  }

  return { recExtra, playExtra, recDeviceName, playDeviceName };
}
