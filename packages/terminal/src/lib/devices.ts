import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

export interface AudioDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
}

export interface VideoDevice {
  id: string; // avfoundation index (e.g., "0") or v4l2 path
  name: string;
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

export function listVideoDevices(): VideoDevice[] {
  const os = platform();

  if (os === 'darwin') {
    return listMacOSVideoDevices();
  }
  if (os === 'linux') {
    return listLinuxVideoDevices();
  }

  return [];
}

function listMacOSVideoDevices(): VideoDevice[] {
  const devices: VideoDevice[] = [];
  try {
    // ffmpeg outputs device list to stderr and exits non-zero — use spawnSync to avoid throw
    const result = spawnSync('ffmpeg', ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const output = result.stderr ?? '';

    let inVideoSection = false;
    for (const line of output.split('\n')) {
      if (line.includes('AVFoundation video devices:')) {
        inVideoSection = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices:')) {
        break;
      }
      if (inVideoSection) {
        const match = line.match(/\[(\d+)] (.+)/);
        if (match) {
          devices.push({ id: match[1], name: match[2] });
        }
      }
    }
  } catch {
    // ffmpeg not available
  }
  return devices;
}

function listLinuxVideoDevices(): VideoDevice[] {
  const devices: VideoDevice[] = [];
  try {
    const output = execSync('ls /dev/video* 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
    for (const line of output.trim().split('\n')) {
      const path = line.trim();
      if (path) {
        devices.push({ id: path, name: path });
      }
    }
  } catch {
    // No video devices
  }
  return devices;
}
