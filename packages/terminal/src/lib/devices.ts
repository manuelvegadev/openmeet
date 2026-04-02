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

export interface ScreenDevice {
  id: string; // macOS: avfoundation index; Linux: X11 display string (e.g. ":0.0+0,0")
  name: string;
  width?: number;
  height?: number;
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

// ─── Video devices ───────────────────────────────────────────────────

export function listVideoDevices(): VideoDevice[] {
  const os = platform();

  if (os === 'darwin') {
    return parseMacOSAvfoundation().cameras;
  }
  if (os === 'linux') {
    return listLinuxVideoDevices();
  }

  return [];
}

// ─── Screen devices ──────────────────────────────────────────────────

export function listScreenDevices(): ScreenDevice[] {
  const os = platform();

  if (os === 'darwin') {
    const screens = parseMacOSAvfoundation().screens;
    // Enrich with display resolutions from system_profiler
    const resolutions = getMacOSScreenResolutions();
    for (let i = 0; i < screens.length; i++) {
      if (i < resolutions.length) {
        screens[i].width = resolutions[i].width;
        screens[i].height = resolutions[i].height;
      }
    }
    return screens;
  }
  if (os === 'linux') {
    return listLinuxScreenDevices();
  }

  return [];
}

// ─── macOS avfoundation (shared parser for cameras + screens) ────────

function parseMacOSAvfoundation(): { cameras: VideoDevice[]; screens: ScreenDevice[] } {
  const cameras: VideoDevice[] = [];
  const screens: ScreenDevice[] = [];

  try {
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
          const id = match[1];
          const name = match[2];
          if (/capture screen/i.test(name)) {
            screens.push({ id, name });
          } else {
            cameras.push({ id, name });
          }
        }
      }
    }
  } catch {
    // ffmpeg not available
  }

  return { cameras, screens };
}

function getMacOSScreenResolutions(): { width: number; height: number }[] {
  const resolutions: { width: number; height: number }[] = [];
  try {
    const json = execSync('system_profiler SPDisplaysDataType -json', { encoding: 'utf-8', timeout: 5000 });
    const data = JSON.parse(json);
    for (const gpu of data.SPDisplaysDataType ?? []) {
      for (const display of gpu.spdisplays_ndrvs ?? []) {
        const res = display._spdisplays_resolution;
        if (res) {
          const match = res.match(/(\d+)\s*x\s*(\d+)/);
          if (match) {
            resolutions.push({ width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10) });
          }
        }
      }
    }
  } catch {
    // system_profiler not available
  }
  return resolutions;
}

// ─── Linux video/screen devices ──────────────────────────────────────

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

function listLinuxScreenDevices(): ScreenDevice[] {
  const screens: ScreenDevice[] = [];
  try {
    const output = execSync('xrandr --query', { encoding: 'utf-8', timeout: 5000 });
    for (const line of output.split('\n')) {
      // Match lines like: "HDMI-1 connected 1920x1080+0+0"
      const match = line.match(/^(\S+)\s+connected\s+(?:primary\s+)?(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const [, name, w, h, offX, offY] = match;
        screens.push({
          id: `:0.0+${offX},${offY}`,
          name: `${name} (${w}x${h})`,
          width: Number.parseInt(w, 10),
          height: Number.parseInt(h, 10),
        });
      }
    }
  } catch {
    // xrandr not available
  }
  if (screens.length === 0) {
    screens.push({ id: ':0.0', name: 'Default screen', width: 1920, height: 1080 });
  }
  return screens;
}
