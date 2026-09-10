/**
 * The palette, and why every value here is hex.
 *
 * Named ANSI colours are not colours: `color="yellow"` emits `ESC[33m`, which means "entry 3
 * of whatever palette your theme defines" — #b58900 in Solarized, #e5c07b in One Dark,
 * #C19C00 in Windows Terminal's Campbell. The same code renders a different hue in every
 * terminal, by design. `dimColor` is worse still: SGR 2 is reduced opacity in one emulator,
 * a substituted palette entry in another, and nothing at all in a third.
 *
 * 24-bit hex avoids both. chalk emits it as `38;2;R;G;B` on a truecolor terminal and
 * quantises to `38;5;N` with N ≥ 16 on a 256-colour one — and indices 16-255 are fixed by
 * the xterm specification rather than by the theme, so Ghostty, iTerm2 and Windows Terminal
 * show the hex and macOS Terminal (256-colour only) shows the nearest cube entry. Nearest by
 * chalk's reckoning, which assumes evenly spaced levels, so a hue can land one step off
 * there: `#4ADE80` becomes the aquamarine `#5FD7AF`. `scripts/theme-test.ts` pins what that
 * rounding must preserve — every pair that carries meaning stays distinct, and everything
 * clears 4.5:1 on the background. Only a 16-colour terminal (bare `TERM=xterm` over ssh)
 * falls back to the theme's palette, and nothing can fix that.
 *
 * The background is painted rather than inherited, which is what makes the app look the same
 * on a light terminal: a dark panel inside it.
 */
export const theme = {
  /** Painted by the app shell, so it covers every cell rather than showing the terminal's. */
  bg: '#0B0B0B',
  text: '#E8E8E8',
  /** Secondary text: timestamps, hints, values that are not the point of the line. */
  muted: '#8A8A8A',

  /** Chrome — borders, rules, headings, the selection marker, buttons. */
  accent: '#E8B900',
  /** Text on top of `accent`. */
  onAccent: '#0B0B0B',
  /** The second accent, for the one thing that is not an ordinary action: debug output. */
  accentAlt: '#C084FC',
  /** A raised grey: the background of a button that would do nothing right now. */
  surface: '#222222',

  // State. Deliberately not yellow: the accent owns yellow now, so a warning needs its own
  // hue or it stops reading as a warning.
  ok: '#4ADE80',
  warn: '#FB923C',
  danger: '#F87171',
  info: '#7DD3FC',

  /**
   * Chat usernames, picked by hash. Six hues from the same lightness band as the state
   * colours but none of *their* hues: a name in the danger red or the warning orange reads as
   * an error or a warning, and the chat sits right beside the list where those mean things.
   * Pink, blue, lime, teal, fuchsia, indigo.
   */
  users: ['#F472B6', '#60A5FA', '#A3E635', '#2DD4BF', '#E879F9', '#818CF8'],
} as const;

/**
 * Border props for every framed Box. Ink draws borders in a pass of their own, so a box that
 * sets `backgroundColor` still leaves the frame's cells showing whatever is behind them —
 * spreading this is what keeps `borderBackgroundColor` from being the thing someone forgets.
 */
export const framedBorder = {
  borderColor: theme.accent,
  borderBackgroundColor: theme.bg,
} as const;
