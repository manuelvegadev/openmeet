import { Box } from 'ink';
import type { ReactNode } from 'react';
import { framedBorder, theme } from '../lib/theme.js';
import { type KeyHint, KeyHints } from './key-hints.js';
import { Text } from './text.js';

interface ModalProps {
  title: string;
  /** The footer buttons, inside the panel. */
  hints?: KeyHint[];
  children?: ReactNode;
}

/**
 * A panel over the room rather than a screen instead of it: you can still see the
 * conversation and who is in the room behind the choice you are making.
 *
 * Ink has no z-order, but it draws the tree in order and Yoga does absolute positioning, so
 * an absolutely positioned box placed last covers what came before it. The overlay itself is
 * transparent and only centres; the panel paints its own background, which is what makes it
 * opaque — a terminal cannot dim what is behind it, so the room simply stays lit around the
 * panel's edges.
 *
 * Rendered by the room *alongside* its own tree, never in place of it, and while it is up the
 * room ignores every key but the ones the modal offers.
 */
export function Modal({ title, hints, children }: ModalProps) {
  return (
    <Box position="absolute" width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        backgroundColor={theme.bg}
        {...framedBorder}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={theme.accent}>
          {title}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {children}
        </Box>
        {hints && (
          <Box marginTop={1}>
            <KeyHints hints={hints} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
