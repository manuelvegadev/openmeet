/**
 * The app's Look settings, on the page.
 *
 * `packages/go/internal/tui/theme.go` is the original: the thirteen accents, the three tones,
 * and the rules that turn a choice into a palette — a tone moves saturation and lightness in
 * HSL and never the hue, `readable` walks the lightness away from the ground until the
 * contrast is there, and the text on the accent is whichever of black and white reads better
 * on it. This is that, in TypeScript, so the page changes the way the app does.
 *
 * The thirteen colours are the one part of it that will actually change — somebody adds an
 * accent — so a Go test (`TestTheWebsitePaletteMatches`) reads `ACCENTS` out of this file and
 * fails if it has drifted from `tui.Accents`. Keep the table in the shape that test expects:
 * one entry per line, `{ name, hex, alt }`.
 */

export interface Accent {
  name: string;
  hex: string;
  alt: string;
}

/** White, then once round the wheel — the same thirteen a name can be, in the same order. */
export const ACCENTS: Accent[] = [
  { name: 'white', hex: '#E8E8E8', alt: '#C084FC' },
  { name: 'red', hex: '#F87171', alt: '#22D3EE' },
  { name: 'orange', hex: '#FB923C', alt: '#60A5FA' },
  { name: 'yellow', hex: '#E8B900', alt: '#C084FC' },
  { name: 'lime', hex: '#A3E635', alt: '#E879F9' },
  { name: 'green', hex: '#4ADE80', alt: '#F472B6' },
  { name: 'teal', hex: '#2DD4BF', alt: '#FB923C' },
  { name: 'cyan', hex: '#22D3EE', alt: '#FB923C' },
  { name: 'blue', hex: '#60A5FA', alt: '#FBBF24' },
  { name: 'indigo', hex: '#818CF8', alt: '#FACC15' },
  { name: 'purple', hex: '#C084FC', alt: '#A3E635' },
  { name: 'fuchsia', hex: '#E879F9', alt: '#4ADE80' },
  { name: 'pink', hex: '#F472B6', alt: '#22D3EE' },
];

export const TONES = ['base', 'vivid', 'pastel'] as const;
export const BACKGROUNDS = ['black', 'white'] as const;
export const BORDERS = ['single', 'double'] as const;
export const CORNERS = ['rounded', 'square'] as const;

/** What the page is drawn in before anyone touches it, and what the prerendered HTML says. */
export const DEFAULT_LOOK = {
  accent: 'yellow',
  tone: 'base',
  background: 'black',
  borders: 'single',
  corners: 'rounded',
} as const;

// The key the look is kept under is written out as a literal in both scripts below rather
// than named here: they are serialized with `toString()` and have to be self-contained, so a
// constant they could not reference would read as a single source of truth while being one
// more thing to keep in step. `check-dist.mjs` asserts the literal is in the <head>.

/**
 * Put the saved look back before the first paint.
 *
 * It applies the colours the panel worked out and **saved with** the choice rather than
 * recomputing them, so this stays four lines of attribute setting and no colour maths: the
 * page must not flash yellow-on-black at somebody who chose green-on-white, and everything
 * that runs at the end of the body is already too late for that. `installThemePanel` then
 * recomputes them from the choice itself, so a saved colour from an older version of the
 * rules is corrected the moment the page finishes parsing.
 *
 * Self-contained: it is serialized with `Function.prototype.toString()` into the `<head>`.
 */
export function installSavedLook(): void {
  try {
    const raw = localStorage.getItem('openmeet:look');
    if (!raw) return;
    const look = JSON.parse(raw) as Record<string, string>;
    const root = document.documentElement;
    for (const key of ['accent', 'tone', 'background', 'borders', 'corners']) {
      const value = look[key];
      if (value) root.setAttribute(`data-${key}`, value);
    }
    for (const key of ['accent', 'accent-alt', 'on-accent', 'selection']) {
      const value = look[`--${key}`];
      if (value) root.style.setProperty(`--${key}`, value);
    }
  } catch {
    // A private window, or site data turned off. The page is the default look, which is fine.
  }
}

/**
 * The floating panel: the thirteen accents, the three tones, and the background, borders and
 * corners, applied to the page the moment they are clicked and kept for the next visit.
 *
 * Self-contained, for the same reason as `installCopyHandler` — no imports, no references to
 * anything outside its own body, because `document.tsx` serializes it into the page. The
 * accents' own colours come from the markup (`data-hex`, `data-alt`) rather than from a table
 * in here, so the list is written once, in ACCENTS, and rendered once.
 */
export function installThemePanel(): void {
  const panel = document.querySelector('.look');
  if (!panel) return;
  const root = document.documentElement;
  const toggle = panel.querySelector('.look__toggle') as HTMLButtonElement | null;
  const body = panel.querySelector('.look__body') as HTMLElement | null;
  if (!toggle || !body) return;

  // ── the colour rules, from packages/go/internal/tui/theme.go ──────────────────────────
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const parse = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const toHex = (r: number, g: number, b: number) =>
    `#${[r, g, b]
      .map((v) =>
        Math.round(clamp(v / 255) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`.toUpperCase();
  const toHSL = (hex: string): [number, number, number] => {
    const [r, g, b] = parse(hex).map((v) => v / 255) as [number, number, number];
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const l = (hi + lo) / 2;
    const d = hi - lo;
    if (d === 0) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
    let h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
    return [h, s, l];
  };
  const fromHSL = (h: number, s: number, l: number) => {
    l = clamp(l);
    s = clamp(s);
    if (s === 0) return toHex(l * 255, l * 255, l * 255);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const ch = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return (p + (q - p) * 6 * t) * 255;
      if (t < 1 / 2) return q * 255;
      if (t < 2 / 3) return (p + (q - p) * (2 / 3 - t) * 6) * 255;
      return p * 255;
    };
    return toHex(ch(h + 1 / 3), ch(h), ch(h - 1 / 3));
  };
  const luminance = (hex: string) => {
    const [r, g, b] = parse(hex).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a) + 0.05, luminance(b) + 0.05].sort((x, y) => y - x);
    return (hi as number) / (lo as number);
  };
  // The same colour said louder or more quietly: the hue never moves, and a grey has no hue
  // to purify, so vivid leaves white alone.
  const toneOf = (hex: string, tone: string) => {
    const [h, s, l] = toHSL(hex);
    if (tone === 'vivid') return s < 0.05 ? hex : fromHSL(h, 1, 0.55 + (l - 0.55) * 0.35);
    if (tone === 'pastel') return fromHSL(h, s * 0.5, l + (1 - l) * 0.45);
    return hex;
  };
  // The floor under both tones: a colour that cannot be told from the ground is not a choice.
  const readable = (hex: string, ground: string) => {
    if (contrast(hex, ground) >= 3) return hex;
    const [h, s, from] = toHSL(hex);
    let l = from;
    const step = luminance(ground) > 0.5 ? -0.04 : 0.04;
    for (let i = 0; i < 25; i++) {
      l = clamp(l + step);
      hex = fromHSL(h, s, l);
      if (contrast(hex, ground) >= 3 || l <= 0 || l >= 1) break;
    }
    return hex;
  };
  const mix = (a: string, b: string, t: number) => {
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    return toHex(br + t * (ar - br), bg + t * (ag - bg), bb + t * (ab - bb));
  };

  // ── applying a choice ─────────────────────────────────────────────────────────────────
  const look: Record<string, string> = {
    accent: 'yellow',
    tone: 'base',
    background: 'black',
    borders: 'single',
    corners: 'rounded',
  };
  for (const key of Object.keys(look)) {
    const saved = root.getAttribute(`data-${key}`);
    if (saved) look[key] = saved;
  }

  // ── the frame's own glyphs ────────────────────────────────────────────────────────────
  //
  // The terminal is characters, so its frame is not a CSS border: it is ╭ ─ │ ├, exported in
  // the set the app ships in. Choosing double borders or square corners means rewriting them,
  // which is the same ten glyphs `setBorders` picks between in packages/go (frame.go). Double
  // is square whatever the corner says, because Unicode has no rounded double corner.
  const SETS: Record<string, string> = {
    rounded: '\u256D\u256E\u2570\u256F\u2500\u2502\u251C\u2524\u252C\u2534',
    square: '\u250C\u2510\u2514\u2518\u2500\u2502\u251C\u2524\u252C\u2534',
    double: '\u2554\u2557\u255A\u255D\u2550\u2551\u2560\u2563\u2566\u2569',
  };
  // Which glyph is which, once: every character any set uses, against its place in a set.
  const WHERE = new Map<string, number>();
  for (const set of Object.values(SETS)) {
    for (let i = 0; i < set.length; i++) WHERE.set(set[i] ?? '', i);
  }
  // What the terminal was exported in, which is the app's own default (theme.go's
  // DefaultAccent row: single, rounded). Thirteen accents, three tones and two grounds cannot
  // change a glyph, so the walk runs on the two rows that can, and only when they move it.
  let drawn = 'rounded';
  const reborder = (borders: string, corners: string) => {
    const name = borders === 'double' ? 'double' : corners === 'square' ? 'square' : 'rounded';
    const want = SETS[name];
    if (!want || name === drawn) return;
    drawn = name;
    for (const grid of document.querySelectorAll('.tt')) {
      const walk = document.createTreeWalker(grid, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const text = node.nodeValue ?? '';
        let out = '';
        let touched = false;
        for (const ch of text) {
          const at = WHERE.get(ch);
          const to = at === undefined ? ch : (want[at] ?? ch);
          if (to !== ch) touched = true;
          out += to;
        }
        if (touched) node.nodeValue = out;
      }
    }
  };

  const apply = (save: boolean) => {
    const swatch = panel.querySelector(`[data-accent="${look.accent}"]`) as HTMLElement | null;
    const base = swatch?.dataset.hex ?? '#E8B900';
    const alt = swatch?.dataset.alt ?? '#C084FC';
    const light = look.background === 'white';
    const ground = light ? '#FFFFFF' : '#0B0B0B';
    const tone = String(look.tone);
    const accent = readable(toneOf(base, tone), ground);
    const colours: Record<string, string> = {
      '--accent': accent,
      '--accent-alt': readable(toneOf(alt, tone), ground),
      '--on-accent': contrast(accent, '#0B0B0B') < contrast(accent, '#FFFFFF') ? '#FFFFFF' : '#0B0B0B',
      '--selection': mix(accent, ground, 0.21),
    };
    for (const [key, value] of Object.entries(look)) root.setAttribute(`data-${key}`, value);
    for (const [key, value] of Object.entries(colours)) root.style.setProperty(key, value);
    reborder(String(look.borders), String(look.corners));
    for (const button of panel.querySelectorAll('[data-set]')) {
      const [key, value] = String(button.getAttribute('data-set')).split(':');
      button.setAttribute('aria-pressed', String(look[String(key)] === value));
    }
    // The swatches show the colour you would actually get, so they follow the tone and the
    // ground — the app's accent row does the same.
    for (const dot of panel.querySelectorAll('[data-accent]')) {
      const el = dot as HTMLElement;
      el.style.setProperty('--swatch', readable(toneOf(String(el.dataset.hex), tone), ground));
    }
    if (save) {
      try {
        localStorage.setItem('openmeet:look', JSON.stringify({ ...look, ...colours }));
      } catch {
        // Nothing to do: the look is applied, it just will not outlive the tab.
      }
    }
  };

  const open = (on: boolean) => {
    panel.classList.toggle('is-open', on);
    toggle.setAttribute('aria-expanded', String(on));
    body.hidden = !on;
  };

  toggle.addEventListener('click', () => open(!panel.classList.contains('is-open')));
  panel.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest('[data-set]') as HTMLElement | null;
    if (!button) return;
    const [key, value] = String(button.getAttribute('data-set')).split(':');
    if (!key || !value) return;
    look[key] = value;
    apply(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') open(false);
  });
  document.addEventListener('click', (event) => {
    if (!panel.contains(event.target as Node)) open(false);
  });

  // The panel does nothing without this script, so the markup ships hidden and this is what
  // puts it on screen.
  (panel as HTMLElement).hidden = false;
  apply(false);
}
