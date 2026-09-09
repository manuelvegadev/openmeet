import { Box } from 'ink';
import type { ReactNode } from 'react';
import { theme } from '../lib/theme.js';
import { type KeyHint, KeyHints } from './key-hints.js';
import { Rule, Text } from './text.js';

interface ScreenProps {
  title: string;
  /** The footer buttons, on the last row. */
  hints?: KeyHint[];
  children?: ReactNode;
}

/**
 * A full-height screen inside the frame: the title on the first row, a rule under it from
 * border to border, the content, and the key hints on the last row — the same chrome the
 * room has, so every screen starts and ends the same way. The padding lives here and the
 * rule sits outside it, which is why `Rule` needs no notion of its container's padding.
 *
 * Title, rule and hints never shrink: on a terminal too short for the content, the content
 * is what gets cut, from the bottom, and the chrome stays where it is.
 */
export function Screen({ title, hints, children }: ScreenProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} flexShrink={0}>
        <Text bold color={theme.accent}>
          {title}
        </Text>
      </Box>
      <Rule />
      <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingX={1} overflowY="hidden">
        {/* The inner column keeps its natural height, so the outer one clips it rather than
            Yoga squeezing every row to nothing and drawing them over each other. */}
        <Box flexDirection="column" flexShrink={0}>
          {children}
        </Box>
      </Box>
      {hints && (
        <Box paddingX={1} flexShrink={0}>
          <KeyHints hints={hints} />
        </Box>
      )}
    </Box>
  );
}
