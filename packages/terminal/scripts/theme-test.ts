/**
 * Device-free check of the palette in `src/lib/theme.ts`:
 * pnpm --filter openmeet-terminal exec tsx scripts/theme-test.ts
 *
 * Two things a hex value can get wrong silently. It can fail to read on the painted
 * background — WCAG asks 4.5:1 for text, and the terminal cannot tell you. And it can be
 * fine in truecolor yet collapse into a neighbour on a 256-colour terminal (macOS Terminal),
 * where chalk rounds every channel to the nearest of six levels — assuming they are evenly
 * spaced, which xterm's are not, so the rounding is coarser than it looks. The rounding
 * checked is `ansi-styles`' own, the code chalk (and so Ink) runs. Every pair that
 * carries meaning has to survive that: the state colours from each other and from the
 * accent, the usernames from each other.
 */
import styles from 'ansi-styles';
import { NAME_PALETTE } from '../src/lib/identity.js';
import { theme } from '../src/lib/theme.js';
import { check, finish } from './harness.js';

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const foregrounds: Record<string, string> = {
  text: theme.text,
  muted: theme.muted,
  accent: theme.accent,
  accentAlt: theme.accentAlt,
  ok: theme.ok,
  warn: theme.warn,
  danger: theme.danger,
  info: theme.info,
};
for (const [i, hex] of theme.users.entries()) {
  foregrounds[`users[${i}]`] = hex;
}
for (const { name, hex } of NAME_PALETTE) {
  foregrounds[`name:${name}`] = hex;
}

for (const [name, hex] of Object.entries(foregrounds)) {
  check(
    `${name} ${hex} reads on the background (${contrast(hex, theme.bg).toFixed(1)}:1)`,
    contrast(hex, theme.bg) >= AA,
    true,
  );
}
check(
  `onAccent reads on accent (${contrast(theme.onAccent, theme.accent).toFixed(1)}:1)`,
  contrast(theme.onAccent, theme.accent) >= AA,
  true,
);
check('muted is darker than text, so "dim" still means dim', luminance(theme.muted) < luminance(theme.text), true);
check(
  `muted reads on surface, the disabled button (${contrast(theme.muted, theme.surface).toFixed(1)}:1)`,
  contrast(theme.muted, theme.surface) >= AA,
  true,
);
check(
  'surface is raised above the background, so a disabled button still shows its edges',
  luminance(theme.surface) > luminance(theme.bg),
  true,
);

function distinctAt256(label: string, entries: [string, string][]) {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, ah] = entries[i];
      const [b, bh] = entries[j];
      check(
        `${label}: ${a} and ${b} stay apart on a 256-colour terminal`,
        styles.hexToAnsi256(ah) !== styles.hexToAnsi256(bh),
        true,
      );
    }
  }
}

distinctAt256('state', [
  ['accent', theme.accent],
  ['accentAlt', theme.accentAlt],
  ['ok', theme.ok],
  ['warn', theme.warn],
  ['danger', theme.danger],
  ['info', theme.info],
]);
distinctAt256(
  'users',
  theme.users.map((hex, i) => [`users[${i}]`, hex]),
);
distinctAt256('greys', [
  ['text', theme.text],
  ['muted', theme.muted],
  ['bg', theme.bg],
]);

const stateHexes = new Set<string>([theme.accent, theme.accentAlt, theme.ok, theme.warn, theme.danger, theme.info]);
check('no username colour doubles as a state colour', theme.users.filter((hex) => stateHexes.has(hex)).length, 0);

finish();
