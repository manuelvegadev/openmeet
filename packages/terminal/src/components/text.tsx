import { Box, Text as InkText } from 'ink';
import type { ComponentProps } from 'react';
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

/**
 * A horizontal rule that spans exactly its container.
 *
 * The obvious version — `<Text>{'─'.repeat(200)}</Text>` — is 200 columns wide whatever the
 * container is, and Ink *wraps* a Text that does not fit rather than clipping it. The excess
 * ran over the frame's right border and off the row, which is why the right edge of the
 * window kept vanishing, why only some rows were affected, and why resizing changed which.
 * A Box's border is laid out by Yoga, so it is as wide as the space it is given and never
 * one column more.
 */
export function Rule() {
  return <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} {...framedBorder} />;
}
