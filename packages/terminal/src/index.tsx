#!/usr/bin/env node
import { type ChildProcess, execSync, spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { parseArgs } from 'node:util';
import { render } from 'ink';
import { App } from './app.js';
import { listScreenDevices } from './lib/devices.js';
import { getOrCreateEmoji } from './lib/emoji.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { APP_VERSION } from './version.js';

function checkSox(): boolean {
  try {
    execSync('which rec', { stdio: 'ignore' });
    execSync('which play', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkFfmpeg(): { ffplay: boolean; ffmpeg: boolean } {
  let ffplay = false;
  let ffmpeg = false;
  try {
    execSync('which ffplay', { stdio: 'ignore' });
    ffplay = true;
  } catch {}
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    ffmpeg = true;
  } catch {}
  return { ffplay, ffmpeg };
}

function checkMicPermission(): 'granted' | 'denied' | 'unknown' {
  if (platform() !== 'darwin') return 'unknown';

  try {
    // Try a brief recording — if mic permission is denied, rec exits with error or produces 0 bytes
    const result = spawnSync(
      'rec',
      ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', '48000', '-', 'trim', '0', '0.1'],
      {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    if (result.error) return 'unknown';

    // If rec produced audio data, permission is granted
    if (result.stdout && result.stdout.length > 0) return 'granted';

    // No data + non-zero exit → likely permission denied
    const stderr = result.stderr?.toString() ?? '';
    if (stderr.includes('permission') || stderr.includes('not authorized') || result.status !== 0) {
      return 'denied';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    server: { type: 'string', default: 'wss://openmeet.mvega.pro/ws' },
    room: { type: 'string' },
    'input-device': { type: 'string' },
    'output-device': { type: 'string' },
    'no-video': { type: 'boolean', default: false },
    'video-device': { type: 'string' },
    'no-overlay': { type: 'boolean', default: false },
    'test-camera': { type: 'boolean', default: false },
    'test-screen': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    debug: { type: 'boolean', default: false },
  },
});

if (values.help) {
  process.stdout.write(`openmeet-terminal v${APP_VERSION}

Usage: openmeet [options]

  --server <url>         WebSocket URL (default: wss://openmeet.mvega.pro/ws)
  --room <id>            Room ID to join
  --input-device <name>  Input device name (skip device picker)
  --output-device <name> Output device name (skip device picker)
  --no-video             Disable video (audio-only mode)
  --video-device <name>  Video capture device (e.g., "0" for macOS avfoundation)
  --no-overlay           Disable video overlay (name, stream type, resolution)
  --test-camera          Test camera capture (opens ffplay preview, no room join)
  --test-screen          Test screen capture (lists screens, opens ffplay preview)
  -h, --help             Show help
`);
  process.exit(0);
}

if (values['test-camera']) {
  const device = values['video-device'] ?? loadSettings().videoDeviceId ?? '0';
  const isMac = platform() === 'darwin';
  process.stdout.write(`Testing camera (device: ${device})... Press q or Esc in the ffplay window to close.\n`);

  const captureArgs = isMac
    ? [
        '-f',
        'avfoundation',
        '-framerate',
        '30',
        '-video_size',
        '640x480',
        '-i',
        `${device}:none`,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'yuv420p',
        '-loglevel',
        'warning',
        'pipe:1',
      ]
    : [
        '-f',
        'v4l2',
        '-framerate',
        '30',
        '-video_size',
        '640x480',
        '-i',
        device,
        '-f',
        'rawvideo',
        '-pix_fmt',
        'yuv420p',
        '-loglevel',
        'warning',
        'pipe:1',
      ];

  const capture: ChildProcess = spawn('ffmpeg', captureArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  const player: ChildProcess = spawn(
    'ffplay',
    [
      '-f',
      'rawvideo',
      '-pixel_format',
      'yuv420p',
      '-video_size',
      '640x480',
      '-framerate',
      '30',
      '-window_title',
      `Camera Test (device ${device})`,
      '-i',
      'pipe:0',
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );

  capture.stdout?.pipe(player.stdin!);
  player.on('close', () => {
    capture.kill();
    process.exit(0);
  });
  capture.on('close', () => {
    player.kill();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    capture.kill();
    player.kill();
  });
  process.on('SIGTERM', () => {
    capture.kill();
    player.kill();
  });
  // eslint-disable-next-line -- keep process alive while test runs
  setInterval(() => {}, 60000);
} else if (values['test-screen']) {
  const isMac = platform() === 'darwin';
  const screens = listScreenDevices();
  if (screens.length === 0) {
    process.stderr.write('No screen devices found.\n');
    process.exit(1);
  }
  process.stdout.write('Available screens:\n');
  for (const s of screens) {
    process.stdout.write(`  [${s.id}] ${s.name}${s.width && s.height ? ` (${s.width}x${s.height})` : ''}\n`);
  }
  const screen = screens[0];
  process.stdout.write(`\nTesting screen capture: ${screen.name}... Press q or Esc in the ffplay window to close.\n`);

  const scaleFilter =
    'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';
  const captureArgs = isMac
    ? [
        '-f',
        'avfoundation',
        '-capture_cursor',
        '1',
        '-framerate',
        '30',
        '-i',
        `${screen.id}:none`,
        '-vf',
        scaleFilter,
        '-r',
        '30',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'yuv420p',
        '-loglevel',
        'warning',
        'pipe:1',
      ]
    : [
        '-f',
        'x11grab',
        '-framerate',
        '30',
        '-video_size',
        `${screen.width ?? 1920}x${screen.height ?? 1080}`,
        '-i',
        screen.id,
        '-vf',
        scaleFilter,
        '-r',
        '30',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'yuv420p',
        '-loglevel',
        'warning',
        'pipe:1',
      ];

  const capture: ChildProcess = spawn('ffmpeg', captureArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
  const player: ChildProcess = spawn(
    'ffplay',
    [
      '-f',
      'rawvideo',
      '-pixel_format',
      'yuv420p',
      '-video_size',
      '1920x1080',
      '-framerate',
      '30',
      '-window_title',
      `Screen Test (${screen.name})`,
      '-i',
      'pipe:0',
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  );

  capture.stdout?.pipe(player.stdin!);
  player.on('close', () => {
    capture.kill();
    process.exit(0);
  });
  capture.on('close', () => {
    player.kill();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    capture.kill();
    player.kill();
  });
  process.on('SIGTERM', () => {
    capture.kill();
    player.kill();
  });
  setInterval(() => {}, 60000);
} else {
  // ─── Normal app flow ──────────────────────────────────────────────────

  if (!checkSox()) {
    process.stderr.write(`Error: sox is required but not found on PATH.

Install sox:
  macOS:   brew install sox
  Ubuntu:  sudo apt install sox
  Fedora:  sudo dnf install sox
`);
    process.exit(1);
  }

  // Video support: soft-fail if ffmpeg/ffplay missing (unlike sox which is hard-fail)
  let videoEnabled = !values['no-video'];
  if (videoEnabled) {
    const ffStatus = checkFfmpeg();
    if (!ffStatus.ffplay || !ffStatus.ffmpeg) {
      process.stderr.write(`Warning: ffmpeg/ffplay not found. Video support disabled.

Install ffmpeg for video support:
  macOS:   brew install ffmpeg
  Ubuntu:  sudo apt install ffmpeg
  Fedora:  sudo dnf install ffmpeg

`);
      videoEnabled = false;
    }
  }

  const micStatus = checkMicPermission();
  if (micStatus === 'denied') {
    process.stderr.write(`Error: Microphone access denied.

Your terminal app needs microphone permission on macOS:
  1. Open System Settings > Privacy & Security > Microphone
  2. Enable the toggle for your terminal app (Terminal, iTerm2, Warp, etc.)
  3. Restart the terminal and try again
`);
    process.exit(1);
  }

  // Persist --no-overlay flag to settings if provided
  if (values['no-overlay']) {
    saveSettings({ videoOverlay: false });
  }

  const emoji = getOrCreateEmoji();

  // Suppress console output to keep TUI clean
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  // Enter alternate screen buffer (like nano/vim) — restores terminal on exit
  process.stdout.write('\x1b[?1049h');

  // Ink uses ansiEscapes.clearTerminal (\x1b[2J\x1b[3J\x1b[H]) when output fills the screen.
  // \x1b[3J clears the scrollback buffer, which on macOS leaks through to the main buffer
  // even when inside the alt screen. Strip it so the user's terminal history is preserved.
  const origStdoutWrite = process.stdout.write;
  process.stdout.write = function (chunk, ...args: any[]) {
    if (typeof chunk === 'string') {
      chunk = chunk.replaceAll('\x1b[3J', '');
    }
    return origStdoutWrite.call(this, chunk, ...args);
  } as typeof process.stdout.write;

  const instance = render(
    <App
      serverUrl={values.server ?? 'wss://openmeet.mvega.pro/ws'}
      emoji={emoji}
      version={APP_VERSION}
      initialRoom={values.room}
      inputDevice={values['input-device']}
      outputDevice={values['output-device']}
      videoEnabled={videoEnabled}
      videoDevice={values['video-device']}
      debug={values.debug ?? false}
    />,
  );

  // After Ink unmounts, trigger process exit
  instance.waitUntilExit().then(() => {
    process.exit(0);
  });

  // Registered AFTER render() so this runs AFTER Ink's own exit handler.
  // Ink's cleanup writes to the alt buffer, then we leave it — normal buffer untouched.
  process.on('exit', () => {
    process.stdout.write('\x1b[?1049l');
  });
} // end else (test-camera)
