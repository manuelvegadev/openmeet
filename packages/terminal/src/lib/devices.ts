import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

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
