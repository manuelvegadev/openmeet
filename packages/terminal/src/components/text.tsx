import { Box, Text as InkText } from 'ink';
import type { ComponentProps, ReactNode } from 'react';
import { framedBorder, theme } from '../lib/theme.js';

type InkTextProps = ComponentProps<typeof InkText>;

/**
 * `Text` with the theme's colours applied by default.
 *
 * Ink inherits a background down the tree but not a foreground, so a bare `<Text>` renders in
 * the terminal's default foreground — which on a light theme is black, and the app paints a
 * dark background underneath it. Defaulting the colour here is what stops that from being a
 * bug every time someone adds a line of text.
 *
 * `dimColor` is accepted and remapped to an explicit grey rather than passed through, because
 * SGR 2 renders differently in every terminal (see lib/theme.ts).
 */
export function Text({ color, dimColor, ...rest }: InkTextProps) {
  return <InkText color={dimColor ? theme.muted : (color ?? theme.text)} {...rest} />;
}

type BoxProps = ComponentProps<typeof Box>;

/**
 * One run of `─`, optionally starting or ending in a junction character, laid out by Yoga.
 *
 * It is a Box with a custom top border, not a Text: Ink draws a border exactly as wide as
 * the box, whereas a Text with a `repeat`-ed string is as wide as the string, and Ink *wraps*
 * a Text that does not fit rather than clipping it (gotcha 30d). The junctions ride along as
 * the border's corner glyphs, which Ink only draws when that side's border is on — so a run
 * with `start` also turns on `borderLeft`, and at height 1 the side border has no rows to
 * draw, leaving just the corner.
 */
export function Line({ start, end, ...box }: { start?: string; end?: string } & BoxProps) {
  return (
    <Box
      height={1}
      borderStyle={{
        topLeft: start ?? '',
        top: '─',
        topRight: end ?? '',
        left: '│',
        right: '│',
        bottomLeft: '',
        bottom: '',
        bottomRight: '',
      }}
      borderTop
      borderBottom={false}
      borderLeft={start !== undefined}
      borderRight={end !== undefined}
      {...framedBorder}
      {...box}
    />
  );
}

/**
 * A horizontal rule from frame edge to frame edge, joined to it with `├` and `┤`.
 *
 * The rule bleeds one column past its container on each side, onto the frame's border cells
 * (`FullScreen` clips vertically only, so the junction glyphs land on top of the `│`). It
 * therefore belongs directly in an unpadded column — `Screen` and `SplitPanes` place it so;
 * inside a padded box it would stop short of the frame.
 *
 * The middle is `children` when given — runs of `Line` that mirror a split below or above,
 * so a `┬` or `┴` lands exactly on the divider's column because both rows are laid out by
 * Yoga from the same flex props — and one plain run otherwise.
 */
export function Rule({ children }: { children?: ReactNode }) {
  // `flexShrink={0}`: when a screen's content is taller than the terminal, Yoga shrinks the
  // children that let it, and a rule shrunk to no rows leaves the content drawn over its line.
  return (
    <Box height={1} flexShrink={0} marginLeft={-1} marginRight={-1}>
      <Line start="├" width={1} />
      <Box flexGrow={1}>{children ?? <Line flexGrow={1} />}</Box>
      <Line end="┤" width={1} />
    </Box>
  );
}

/**
 * A separator *within* a panel: a rule as wide as its container and no wider, so it stays
 * clear of the frame and of any divider beside it. `Rule` is the other one — it bleeds over
 * both to join them, which is right for a section break across the room and wrong for a line
 * that only groups rows inside one column.
 */
export function Divider() {
  return (
    <Box
      width="100%"
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      {...framedBorder}
    />
  );
}

/** The one selection marker, wherever a list has a current row. */
export const POINTER = '▸';

/** The marker cell of a list row: the pointer in the accent when this is the current row, blank otherwise. */
export function Pointer({ on }: { on: boolean }) {
  return <Text color={theme.accent}>{on ? POINTER : ' '}</Text>;
}
