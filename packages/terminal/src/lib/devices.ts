import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { POWERSHELL, powershellArgs, runPowerShell } from './powershell.js';
import { ffmpegBin } from './tool-path.js';

export interface VideoDevice {
  id: string; // avfoundation index (e.g., "0") or v4l2 path
  name: string;
}

export interface ScreenDevice {
  id: string; // macOS: avfoundation index; Linux: X11 display string (e.g. ":0.0+0,0"); Windows: display name
  name: string;
  width?: number;
  height?: number;
  /** Windows: top-left corner in the virtual desktop, relative to the primary monitor's origin. */
  x?: number;
  y?: number;
  primary?: boolean;
  /**
   * Windows: which DXGI output ddagrab should capture.
   *
   * Taken from the order `Screen.AllScreens` enumerates monitors, which matches DXGI's
   * output order on a single-adapter machine but is not guaranteed to in general. Verified
   * with one monitor only; a multi-monitor or multi-GPU box may need a real
   * `DXGI_OUTPUT_DESC.DeviceName` lookup.
   */
  outputIndex?: number;
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

/**
 * Enumeration is synchronous (it runs in the TUI process on the `s` key), and on Windows it
 * costs ~1 s of PowerShell startup, so the result is cached briefly and `prefetchScreenDevices`
 * warms it in the background when a room opens.
 */
const SCREEN_CACHE_MS = 60_000;
let screenCache: { at: number; screens: ScreenDevice[] } | null = null;

export function listScreenDevices(): ScreenDevice[] {
  if (screenCache && Date.now() - screenCache.at < SCREEN_CACHE_MS) return screenCache.screens;
  const screens = enumerateScreens();
  screenCache = { at: Date.now(), screens };
  return screens;
}

/** Fill the cache without blocking (Windows only; the other platforms enumerate fast enough). */
export function prefetchScreenDevices(): void {
  if (platform() !== 'win32') return;
  void runPowerShell(WINDOWS_SCREENS_SCRIPT).then((stdout) => {
    if (stdout != null) screenCache = { at: Date.now(), screens: windowsScreensFromOutput(stdout) };
  });
}

function enumerateScreens(): ScreenDevice[] {
  const os = platform();

  if (os === 'darwin') {
    const screens = parseMacOSAvfoundation().screens;
    const displays = getMacOSDisplays();
    for (const [i, screen] of screens.entries()) {
      const display = displays[i];
      if (!display) continue;
      if (display.name) screen.name = display.name;
      screen.width = display.width;
      screen.height = display.height;
      screen.primary = display.primary;
    }
    return screens;
  }
  if (os === 'linux') {
    return listLinuxScreenDevices();
  }
  if (os === 'win32') {
    return listWindowsScreenDevices();
  }

  return [];
}

// ─── macOS avfoundation (shared parser for cameras + screens) ────────

function parseMacOSAvfoundation(): { cameras: VideoDevice[]; screens: ScreenDevice[] } {
  const cameras: VideoDevice[] = [];
  const screens: ScreenDevice[] = [];

  try {
    const result = spawnSync(ffmpegBin(), ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], {
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

/**
 * What macOS knows about each attached display: the monitor's own name ("Odyssey G85SB",
 * "Built-in Retina Display"), its logical resolution and whether it is the main one.
 * `ffmpeg -list_devices` only ever says "Capture screen 0", which is no help with two
 * monitors, so the picker's labels come from here and the index still comes from ffmpeg.
 * The two lists are matched by position, as the resolutions already were.
 */
function getMacOSDisplays(): { name?: string; width?: number; height?: number; primary?: boolean }[] {
  const displays: { name?: string; width?: number; height?: number; primary?: boolean }[] = [];
  try {
    const json = execSync('system_profiler SPDisplaysDataType -json', { encoding: 'utf-8', timeout: 5000 });
    const data = JSON.parse(json);
    for (const gpu of data.SPDisplaysDataType ?? []) {
      for (const display of gpu.spdisplays_ndrvs ?? []) {
        // "3096 x 1296 @ 120.00Hz" — the logical size, which is what avfoundation captures.
        const match = /(\d+)\s*x\s*(\d+)/.exec(display._spdisplays_resolution ?? '');
        displays.push({
          name: typeof display._name === 'string' ? display._name : undefined,
          width: match ? Number.parseInt(match[1], 10) : undefined,
          height: match ? Number.parseInt(match[2], 10) : undefined,
          primary: display.spdisplays_main === 'spdisplays_yes',
        });
      }
    }
  } catch {
    // system_profiler not available
  }
  return displays;
}

// ─── Windows screens ─────────────────────────────────────────────────

/**
 * Monitors with physical-pixel bounds. The process must be DPI-aware before asking, or
 * Windows reports scaled sizes for high-DPI displays (ffmpeg's gdigrab is DPI-aware and
 * captures physical pixels). Only the interactive session sees real monitors: from an SSH
 * session there is a fake 1024x768 "WinDisc" display and gdigrab fails.
 */
const WINDOWS_SCREENS_SCRIPT = `
Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][W.D]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { '{0}|{1}|{2}|{3}|{4}|{5}' -f $_.DeviceName, $_.Bounds.X, $_.Bounds.Y, $_.Bounds.Width, $_.Bounds.Height, $_.Primary }
`;

const WINDOWS_SCREENS_ARGS = powershellArgs(WINDOWS_SCREENS_SCRIPT);

function listWindowsScreenDevices(): ScreenDevice[] {
  try {
    const result = spawnSync(POWERSHELL, WINDOWS_SCREENS_ARGS, {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    return windowsScreensFromOutput(result.stdout ?? '');
  } catch {
    return windowsScreensFromOutput('');
  }
}

/** Parse `name|x|y|w|h|primary` lines; primary first so a single Enter shares the main monitor. */
function windowsScreensFromOutput(output: string): ScreenDevice[] {
  const screens: ScreenDevice[] = [];
  // Enumeration order, kept before the primary-first reorder below: it is what ddagrab's
  // output_idx counts, and it is not the order the user sees in the list.
  let enumerated = 0;
  for (const line of output.split(/\r?\n/)) {
    const [device, x, y, w, h, primary] = line.trim().split('|');
    if (!device || !w || !h) continue;
    const screen: ScreenDevice = {
      id: device,
      outputIndex: enumerated++,
      // `\\.\DISPLAY1` is not a name anyone recognises; the picker adds the size and the
      // "main" mark itself, so this is just which monitor Windows thinks it is.
      name: `Display ${device.replace(/^\\\\[.?]\\/, '')}`,
      width: Number.parseInt(w, 10),
      height: Number.parseInt(h, 10),
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
      primary: primary === 'True',
    };
    if (screen.primary) screens.unshift(screen);
    else screens.push(screen);
  }
  // No bounds known: gdigrab captures the whole virtual desktop.
  if (screens.length === 0) screens.push({ id: 'desktop', name: 'Desktop' });
  return screens;
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
      const match = line.match(/^(\S+)\s+connected\s+(primary\s+)?(\d+)x(\d+)\+(\d+)\+(\d+)/);
      if (match) {
        const [, name, primary, w, h, offX, offY] = match;
        screens.push({
          id: `:0.0+${offX},${offY}`,
          name,
          width: Number.parseInt(w, 10),
          height: Number.parseInt(h, 10),
          primary: !!primary,
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
