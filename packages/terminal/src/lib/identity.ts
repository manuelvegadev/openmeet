import stringWidth from 'string-width';
import { theme } from './theme.js';

/**
 * Who you are in a room: a short name and a colour, chosen once at first start and kept in
 * settings. The name is what others read and say; the colour is how your name is drawn —
 * `[Mario]`, brackets included, in that colour — everywhere: the participants column, the
 * chat's who column, the home screen. Both travel with `join-room`, so peers draw you the
 * way you chose.
 */
export interface Identity {
  name: string;
  color: string;
}

/**
 * The name's ceiling, in terminal cells, so `[name]` has a known widest form and the
 * participants column can be sized once. Cells, not characters: Ink lays text out with
 * `string-width`, and a CJK or emoji character takes two. Names are cut to it where they
 * enter — yours in the profile screens, a peer's in the engine — so nothing downstream
 * measures again.
 */
export const NAME_MAX_CELLS = 8;

/**
 * The colours a name can be, in the order the picker shows them: white, then round the hue
 * wheel. One lightness band (the same as the state colours, so all of them clear 4.5:1 on the
 * background — `scripts/theme-test.ts` checks), no greys, which would read as disabled.
 */
export const NAME_PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'white', hex: '#E8E8E8' },
  { name: 'red', hex: '#F87171' },
  { name: 'orange', hex: '#FB923C' },
  { name: 'yellow', hex: '#FACC15' },
  { name: 'lime', hex: '#A3E635' },
  { name: 'green', hex: '#4ADE80' },
  { name: 'teal', hex: '#2DD4BF' },
  { name: 'cyan', hex: '#22D3EE' },
  { name: 'blue', hex: '#60A5FA' },
  { name: 'indigo', hex: '#818CF8' },
  { name: 'purple', hex: '#C084FC' },
  { name: 'fuchsia', hex: '#E879F9' },
  { name: 'pink', hex: '#F472B6' },
];

/**
 * Cut a name down to what is allowed while it is being typed: no control characters, no
 * brackets (they are the name's frame), whitespace collapsed to single spaces, and at most
 * `NAME_MAX_CELLS` cells. Leading whitespace is dropped here; trailing is left for `finishName`
 * so a space can be typed mid-name.
 */
/** Control characters (C0 and DEL) and the brackets. Built, not written, so the source holds none. */
const UNWANTED = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}[\\]]`,
  'g',
);

export function clampName(raw: string): string {
  const clean = raw.replace(UNWANTED, '').replace(/\s+/g, ' ').replace(/^ /, '');
  let out = '';
  for (const char of clean) {
    if (stringWidth(out + char) > NAME_MAX_CELLS) break;
    out += char;
  }
  return out;
}

/** The name as saved: clamped and trimmed. Empty means there is no name. */
export function finishName(raw: string): string {
  return clampName(raw).trim();
}

/** A colour we will draw a name in: one of ours, or any `#rrggbb` a peer's client sent. */
export function isNameColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * The colour to draw a name in: the one chosen when it is known and valid, otherwise one
 * picked by hashing the name — what the chat did before names carried a colour, and what a
 * peer on an older client still gets.
 */
export function colorForName(name: string, chosen?: string | null): string {
  if (isNameColor(chosen)) return chosen;
  let hash = 0;
  for (const char of name) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return theme.users[Math.abs(hash) % theme.users.length];
}

/** `[name]`, the form every name is shown in. */
export function bracketed(name: string): string {
  return `[${name || '?'}]`;
}

/** The palette entry for a colour, if it is one of ours. */
export function paletteEntry(hex: string | null | undefined): { name: string; hex: string } | undefined {
  return NAME_PALETTE.find((c) => c.hex === hex);
}
