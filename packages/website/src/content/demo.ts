import type { TuiLine } from './types';

/**
 * The parts of the page that are the same in every language: the demo room's cast and script,
 * the measured install sizes, the chips. Only the words live in `en.ts` / `es.ts`, so a change
 * here reaches both pages and the two can never drift into showing different demos.
 */

/** The conversation's skeleton. A `msg` line looks its text up in `Copy.tui.messages` by time. */
export const TUI_SCRIPT: TuiLine[] = [
  { time: '00:22', kind: 'join', who: 'mvega' },
  { time: '00:24', kind: 'join', who: 'sofia' },
  { time: '00:25', kind: 'msg', who: 'sofia' },
  { time: '00:26', kind: 'msg', who: 'mvega' },
  { time: '00:27', kind: 'join', who: 'diego' },
  { time: '00:28', kind: 'msg', who: 'diego' },
  { time: '00:30', kind: 'msg', who: 'sofia' },
  { time: '00:31', kind: 'msg', who: 'sofia' },
  { time: '00:32', kind: 'screen', who: 'sofia' },
  { time: '00:33', kind: 'msg', who: 'mvega' },
  { time: '00:35', kind: 'msg', who: 'diego' },
  { time: '00:36', kind: 'msg', who: 'mvega' },
  { time: '00:37', kind: 'join', who: 'amara' },
  { time: '00:38', kind: 'msg', who: 'amara' },
  { time: '00:39', kind: 'mute', who: 'amara' },
  { time: '00:41', kind: 'msg', who: 'sofia' },
  { time: '00:42', kind: 'msg', who: 'diego' },
  { time: '00:43', kind: 'msg', who: 'mvega' },
];

/** One row of the participants column. Everything here is language-neutral. */
export interface PeerRow {
  who: string;
  /** The state letter: `S`/`s` screen, `C`/`c` camera, `m` muted. Case says whose window is open. */
  tag?: string;
  speaking?: boolean;
  selected?: boolean;
  /** `↑128k` or `↓384k`, as the app draws it. */
  rate?: string;
  latencyMs?: number;
  /** Not shown when the peer is at 100%. */
  volume?: string;
  /** Meter fill, 0-100. Omitted means a silent peer: an empty track. */
  level?: number;
}

export const YOU: PeerRow = { who: 'mvega', tag: 'c', rate: '↑128k', level: 33 };

export const PEERS: PeerRow[] = [
  { who: 'sofia', tag: 'S', speaking: true, selected: true, rate: '↓384k', latencyMs: 38, level: 80 },
  { who: 'diego', tag: 'C', rate: '↓128k', latencyMs: 96, level: 20 },
  { who: 'amara', tag: 'm', rate: '↓128k', latencyMs: 155, volume: '70%' },
];

/** Measured 2026-09-10 on an Apple M4 Pro; see docs/performance.md. */
export const INSTALL_SIZES: { label: string; mb: number; us?: boolean }[] = [
  { label: 'openmeet', mb: 78, us: true },
  { label: 'Discord', mb: 479 },
  { label: 'Google Chrome', mb: 1434 },
];

export const HERO_CHIPS = ['macOS 15+', 'Windows 11', 'MIT', 'P2P'];

export const STACK = [
  'Node.js 22',
  'TypeScript',
  'WebRTC · libwebrtc',
  'Opus + RED',
  'VP8 / VP9',
  'Ink · React for terminals',
  'RtAudio · CoreAudio / WASAPI',
  'ffmpeg',
  'RNNoise',
  'Express 5 + ws',
  'Docker',
];

/** The Opus ladder the settings screen cycles (`AUDIO_KBPS_STEPS` in the terminal's sdp.ts). */
export const AUDIO_KBPS_STEPS = [64, 96, 128, 192, 256];
