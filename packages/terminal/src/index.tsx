#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { parseArgs } from 'node:util';
import { render } from 'ink';
import { App } from './app.js';
import { initEngineClient } from './engine/client.js';
import { runEngine } from './engine/main.js';
import {
  INPUT_CHANNEL_POLICIES,
  INPUT_GAIN_DB_MAX,
  INPUT_GAIN_DB_MIN,
  parseChannelsFlag,
  parseGainFlag,
} from './lib/audio/channels.js';
import { parseBackendFlag, resolveBackendName, setActiveBackendName } from './lib/audio/index.js';
import {
  rawVideoPlayerArgs,
  SCREEN_FPS,
  screenCaptureCandidates,
  screenOutputSize,
  WEBCAM_FPS,
} from './lib/capture-args.js';
import { listScreenDevices, webcamCapturePlan } from './lib/devices.js';
import { diagnosticsEnabled, recordRender } from './lib/diagnostics.js';
import { getPlatformSupport } from './lib/platform.js';
import { startPreview } from './lib/preview.js';
import { AUDIO_KBPS_MAX, AUDIO_KBPS_MIN, parseKbpsFlag, SCREEN_KBPS_MAX, SCREEN_KBPS_MIN } from './lib/sdp.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { findTool } from './lib/tool-path.js';
import {
  createFocusFilteredStdin,
  parsePausePolicyFlag,
  RENDER_PAUSE_POLICIES,
  setTerminalTitle,
  startMinimizedWatcher,
  WINDOW_TITLE,
} from './lib/window-state.js';
import { APP_VERSION } from './version.js';

function checkSox(): boolean {
  return findTool('rec') !== null && findTool('play') !== null;
}

/** Which of ffmpeg/ffplay are nowhere to be found (see lib/tool-path.ts for where we look). */
function missingVideoTools(): string[] {
  return ['ffmpeg', 'ffplay'].filter((tool) => findTool(tool) === null);
}

/**
 * The `--test-*` modes: one preview window, walking the candidate grabbers the way a real
 * capture does — on to the next if one yields nothing — and exiting with the window.
 */
function runPreview(candidates: string[][], playerArgs: string[], index = 0): void {
  const stop = startPreview(candidates[index], playerArgs, ({ sawFrames, error }) => {
    if (error) process.stderr.write(`${error}\n`);
    if (!sawFrames && index + 1 < candidates.length) {
      process.stderr.write('That grabber produced no frames; trying the next one.\n');
      runPreview(candidates, playerArgs, index + 1);
      return;
    }
    process.exit(0);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 60000);
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
    engine: { type: 'boolean', default: false },
    server: { type: 'string', default: 'wss://openmeet.mvega.pro/ws' },
    room: { type: 'string' },
    'input-device': { type: 'string' },
    'output-device': { type: 'string' },
    'no-video': { type: 'boolean', default: false },
    'audio-backend': { type: 'string' },
    'input-channels': { type: 'string' },
    'input-gain': { type: 'string' },
    'audio-send-kbps': { type: 'string' },
    'audio-receive-kbps': { type: 'string' },
    'screen-send-kbps': { type: 'string' },
    'screen-receive-kbps': { type: 'string' },
    'noise-suppression': { type: 'boolean' },
    'no-noise-suppression': { type: 'boolean' },
    'pause-rendering': { type: 'string' },
    'video-device': { type: 'string' },
    'no-overlay': { type: 'boolean', default: false },
    'test-camera': { type: 'boolean', default: false },
    'test-screen': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
    debug: { type: 'boolean', default: false },
  },
});

// ─── Engine process ───────────────────────────────────────────────────
// Forked by the TUI (see engine/client.ts). Owns audio, WebRTC and signaling so the
// 10 ms audio path never shares an event loop with terminal rendering.
if (values.engine) {
  // The TUI passes the resolved backend name; runEngine() never resolves (the process
  // exits from inside when the TUI disconnects).
  setActiveBackendName(resolveBackendName(parseBackendFlag(values['audio-backend']) ?? 'auto'));
  await runEngine();
} else if (values.help) {
  process.stdout.write(`openmeet-terminal v${APP_VERSION}

Usage: openmeet [options]

  --server <url>         WebSocket URL (default: wss://openmeet.mvega.pro/ws)
  --room <id>            Room ID to join
  --input-device <name>  Input device name (skip device picker)
  --output-device <name> Output device name (skip device picker)
  --no-video             Disable video (audio-only mode; webcam is macOS/Linux only)
  --audio-backend <name> Audio I/O backend: rtaudio (native; default on macOS/Windows) or sox (default on Linux)
  --input-channels <p>   auto | stereo | mono | left | right — how the mic's channel pair is sent (saved)
  --input-gain <dB>      Capture gain in dB, e.g. 6 or -3 (saved)
  --audio-send-kbps <n>  Opus ceiling for what we send (default 128, saved)
  --audio-receive-kbps <n>  Opus ceiling for what peers send us (default 128, saved)
  --screen-send-kbps <n>    Screen-share ceiling per peer at 1080p (default 2500, saved)
  --screen-receive-kbps <n> Screen-share ceiling we ask of each peer (default 2500, saved)
  --noise-suppression    Enable RNNoise on the mic (--no-noise-suppression to turn off, saved)
  --pause-rendering <p>  minimized (default) | unfocused | never — when to pause TUI rendering (saved)
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
  const plan = await webcamCapturePlan(device);
  if (!plan) {
    process.stderr.write(`Webcam capture is not available on ${getPlatformSupport().name}.\n`);
    process.exit(1);
  }
  const { args: captureArgs, size } = plan;
  process.stdout.write(
    `Testing camera (device: ${device}, ${size.width}x${size.height})... Press q or Esc in the ffplay window to close.\n`,
  );
  runPreview([captureArgs], rawVideoPlayerArgs(size.width, size.height, WEBCAM_FPS, `Camera Test (device ${device})`));
} else if (values['test-screen']) {
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
  const out = screenOutputSize(screen);
  process.stdout.write(
    `\nTesting screen capture: ${screen.name} → ${out.width}x${out.height}... Press q or Esc in the ffplay window to close.\n`,
  );
  runPreview(
    screenCaptureCandidates(screen),
    rawVideoPlayerArgs(out.width, out.height, SCREEN_FPS, `Screen Test (${screen.name})`),
  );
} else {
  // ─── Normal app flow ──────────────────────────────────────────────────

  // Audio backend: CLI flag > saved setting > platform default
  const backendFlag = parseBackendFlag(values['audio-backend']);
  if (backendFlag === null) {
    process.stderr.write(`Error: --audio-backend must be "rtaudio" or "sox" (got "${values['audio-backend']}")\n`);
    process.exit(1);
  }
  const audioBackend = resolveBackendName(backendFlag === 'auto' ? loadSettings().audioBackend : backendFlag);
  // The engine gets the resolved backend explicitly; start it now so device listing
  // and the first join don't pay the fork + native-module load.
  const engine = initEngineClient(['--audio-backend', audioBackend]);
  engine.start();

  if (audioBackend === 'sox' && !checkSox()) {
    process.stderr.write(`Error: sox is required but not found on PATH.

Install sox:
  macOS:   brew install sox
  Ubuntu:  sudo apt install sox
  Fedora:  sudo dnf install sox
`);
    process.exit(1);
  }

  // Video support: soft-fail if ffmpeg/ffplay missing. Gated per platform (see lib/platform.ts).
  const support = getPlatformSupport();
  // One fact — why video is off — and `videoEnabled` derived from it. The reason reaches the
  // room log, because the stderr warning below is covered by the alternate screen the
  // instant Ink starts; without it a dead `s` key was the only symptom.
  const missing = values['no-video'] || !support.video ? [] : missingVideoTools();
  const videoDisabledReason = values['no-video']
    ? '--no-video'
    : !support.video
      ? `not available on ${support.name}`
      : missing.length > 0
        ? `${missing.join(' and ')} not found (PATH, WinGet Links, Program Files\\ffmpeg)`
        : undefined;
  const videoEnabled = videoDisabledReason === undefined;
  if (missing.length > 0) {
    process.stderr.write(`Warning: ffmpeg/ffplay not found. Video support disabled.

Install ffmpeg for video support:
  macOS:   brew install ffmpeg
  Windows: winget install Gyan.FFmpeg
  Ubuntu:  sudo apt install ffmpeg
  Fedora:  sudo dnf install ffmpeg

`);
  }

  // The sox probe uses `rec`; with rtaudio a denied mic surfaces as a stream error instead.
  const micStatus = audioBackend === 'sox' ? checkMicPermission() : 'unknown';
  if (micStatus === 'denied') {
    process.stderr.write(`Error: Microphone access denied.

Your terminal app needs microphone permission on macOS:
  1. Open System Settings > Privacy & Security > Microphone
  2. Enable the toggle for your terminal app (Terminal, iTerm2, Warp, etc.)
  3. Restart the terminal and try again
`);
    process.exit(1);
  }

  // Persist audio flags to settings (the engine process reads them at join)
  if (values['no-overlay']) saveSettings({ videoOverlay: false });
  if (values['input-channels'] !== undefined) {
    const policy = parseChannelsFlag(values['input-channels']);
    if (policy === null) {
      process.stderr.write(`Error: --input-channels must be one of ${INPUT_CHANNEL_POLICIES.join(', ')} (got "${values['input-channels']}")
`);
      process.exit(1);
    }
    saveSettings({ audioInputChannels: policy });
  }
  if (values['input-gain'] !== undefined) {
    const gainDb = parseGainFlag(values['input-gain']);
    if (gainDb === null) {
      process.stderr.write(`Error: --input-gain must be ${INPUT_GAIN_DB_MIN}..${INPUT_GAIN_DB_MAX} dB (got "${values['input-gain']}")
`);
      process.exit(1);
    }
    saveSettings({ audioInputGainDb: gainDb });
  }
  for (const [flag, key, min, max] of [
    ['audio-send-kbps', 'audioSendKbps', AUDIO_KBPS_MIN, AUDIO_KBPS_MAX],
    ['audio-receive-kbps', 'audioReceiveKbps', AUDIO_KBPS_MIN, AUDIO_KBPS_MAX],
    ['screen-send-kbps', 'screenSendKbps', SCREEN_KBPS_MIN, SCREEN_KBPS_MAX],
    ['screen-receive-kbps', 'screenReceiveKbps', SCREEN_KBPS_MIN, SCREEN_KBPS_MAX],
  ] as const) {
    if (values[flag] === undefined) continue;
    const kbps = parseKbpsFlag(values[flag], min, max);
    if (kbps === null) {
      process.stderr.write(`Error: --${flag} must be ${min}..${max} (got "${values[flag]}")\n`);
      process.exit(1);
    }
    saveSettings({ [key]: kbps });
  }
  if (values['noise-suppression']) saveSettings({ noiseSuppression: true });
  if (values['no-noise-suppression']) saveSettings({ noiseSuppression: false });
  if (values['pause-rendering'] !== undefined) {
    const policy = parsePausePolicyFlag(values['pause-rendering']);
    if (policy === null) {
      process.stderr.write(
        `Error: --pause-rendering must be one of ${RENDER_PAUSE_POLICIES.join(', ')} (got "${values['pause-rendering']}")\n`,
      );
      process.exit(1);
    }
    saveSettings({ pauseRendering: policy });
  }

  // Suppress console output to keep TUI clean
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  // Ink uses ansiEscapes.clearTerminal (\x1b[2J\x1b[3J\x1b[H]) when output fills the screen.
  // \x1b[3J clears the scrollback buffer, which on macOS leaks through to the main buffer
  // even when inside the alt screen. Strip it so the user's terminal history is preserved.
  const origStdoutWrite = process.stdout.write;
  process.stdout.write = function (this: NodeJS.WriteStream, chunk, ...args: any[]) {
    if (typeof chunk === 'string') {
      chunk = chunk.replaceAll('\x1b[3J', '');
    }
    return origStdoutWrite.call(this, chunk, ...args);
  } as typeof process.stdout.write;

  // alternateScreen: Ink enters/leaves the alt buffer itself (like vim/htop).
  // Rendering pause policy (see lib/window-state.ts). The window title lets the OS-side
  // minimized watchers find our window; Windows Terminal's profile pins it anyway.
  const pausePolicy = loadSettings().pauseRendering;
  setTerminalTitle(WINDOW_TITLE);
  const engineLog = (message: string) => engine.send({ type: 'log', message });
  const stopWatcher = pausePolicy === 'minimized' ? startMinimizedWatcher(engineLog) : () => {};
  const stdinForInk = pausePolicy === 'unfocused' ? createFocusFilteredStdin(process.stdin) : undefined;

  const instance = render(
    <App
      serverUrl={values.server ?? 'wss://openmeet.mvega.pro/ws'}
      version={APP_VERSION}
      initialRoom={values.room}
      inputDevice={values['input-device']}
      outputDevice={values['output-device']}
      videoEnabled={videoEnabled}
      videoDisabledReason={videoDisabledReason}
      webcamEnabled={videoEnabled && support.webcam}
      videoDevice={values['video-device']}
      debug={values.debug ?? false}
    />,
    {
      alternateScreen: true,
      // Only override stdin when we actually filter it: an explicit `undefined` makes Ink
      // believe there is no TTY and it stops rendering until unmount.
      ...(stdinForInk ? { stdin: stdinForInk } : {}),
      // Off on purpose: incremental writes position the cursor from the previous frame's
      // geometry, which a resize invalidates, and the frame's right border was the casualty.
      // Full frames cost 0.19 ms a write — see gotcha 30f for the measurements.
      incrementalRendering: false,
      onRender: diagnosticsEnabled(values.debug ?? false) ? recordRender : undefined,
    },
  );

  // After Ink unmounts, stop the engine and exit
  instance.waitUntilExit().then(() => {
    stopWatcher();
    engine.dispose();
    setTimeout(() => process.exit(0), 100);
  });
  process.on('exit', () => {
    stopWatcher();
    engine.dispose();
  });
  // A plain SIGTERM would skip the 'exit' handlers above.
  process.on('SIGTERM', () => process.exit(0));
} // end else (test-camera)
