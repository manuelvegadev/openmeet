#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { parseArgs } from 'node:util';
import { render } from 'ink';
import { App } from './app.js';
import { getOrCreateEmoji } from './lib/emoji.js';

function checkSox(): boolean {
  try {
    execSync('which rec', { stdio: 'ignore' });
    execSync('which play', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  options: {
    server: { type: 'string', default: 'ws://localhost:3001/ws' },
    room: { type: 'string' },
    'input-device': { type: 'string' },
    'output-device': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  process.stdout.write(`Usage: openmeet [options]

  --server <url>         WebSocket URL (default: ws://localhost:3001/ws)
  --room <id>            Room ID to join
  --input-device <name>  Input device name (skip device picker)
  --output-device <name> Output device name (skip device picker)
  -h, --help             Show help
`);
  process.exit(0);
}

if (!checkSox()) {
  process.stderr.write(`Error: sox is required but not found on PATH.

Install sox:
  macOS:   brew install sox
  Ubuntu:  sudo apt install sox
  Fedora:  sudo dnf install sox
`);
  process.exit(1);
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

const emoji = getOrCreateEmoji();

// Suppress console output to keep TUI clean
console.log = () => {};
console.error = () => {};
console.warn = () => {};

// Enter alternate screen buffer so the TUI is the only visible content
process.stdout.write('\x1b[?1049h');
process.on('exit', () => {
  process.stdout.write('\x1b[?1049l');
});

render(
  <App
    serverUrl={values.server ?? 'ws://localhost:3001/ws'}
    emoji={emoji}
    initialRoom={values.room}
    inputDevice={values['input-device']}
    outputDevice={values['output-device']}
  />,
);
