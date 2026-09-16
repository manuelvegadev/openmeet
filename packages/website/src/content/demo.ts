/**
 * The parts of the page that are the same in every language: the demo room's cast, the
 * measured install sizes, the chips.
 *
 * The terminal is **not** here any more. It is `terminal.json`, exported from the application
 * itself by a Go test that plays the same `--demo` against a canvas, so what the page shows is
 * what the room draws rather than a copy of it somebody typed out. What is left here is the
 * handful of rows the story panes draw beside their prose.
 */

/** One row of the participants column. Everything here is language-neutral. */
export interface PeerRow {
  who: string;
  /** The state letter: `S`/`s` screen, `C`/`c` camera, `m` muted. Case says whose window is open. */
  tag?: string;
  speaking?: boolean;
  selected?: boolean;
  /** `↑128k` or `↓2480k`, as the app draws it. */
  rate?: string;
  latencyMs?: number;
  /** Not shown when the peer is at 100%. */
  volume?: string;
}

/** The two other people in the room `--demo` opens: one sharing a screen, one muted. */
export const PEERS: PeerRow[] = [
  { who: 'Mario', tag: 'S', selected: true, rate: '↓2480k', latencyMs: 41 },
  { who: 'amara', tag: 'm', rate: '↓128k', latencyMs: 156, volume: '70%' },
];

/**
 * Discord and Chrome measured 2026-09-10 on an Apple M4 Pro (docs/performance.md); openmeet is the
 * arm64 binary of 2026-09-11 — the whole install, there is nothing else.
 */
export const INSTALL_SIZES: { label: string; mb: number; us?: boolean }[] = [
  { label: 'openmeet', mb: 12, us: true },
  { label: 'Discord', mb: 479 },
  { label: 'Google Chrome', mb: 1434 },
];

export const HERO_CHIPS = ['macOS 15+', 'Windows 11', 'MIT', 'P2P', '12 MB'];

export const STACK = [
  'Go',
  'pion · WebRTC',
  'Opus · libopus',
  'H.264 · VideoToolbox / NVENC',
  'miniaudio · CoreAudio / WASAPI',
  'SCTP data channels',
  'Bubble Tea',
  'ffmpeg',
  'Express 5 + ws',
  'TypeScript',
  'Docker',
];

/** The one encoder's default, and the flag that moves it (`--audio-kbps` in packages/go). */
export const AUDIO_KBPS_DEFAULT = 128;
export const AUDIO_KBPS_FLAG = `--audio-kbps ${AUDIO_KBPS_DEFAULT}`;
