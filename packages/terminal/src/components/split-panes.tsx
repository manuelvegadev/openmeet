import { Box } from 'ink';
import type { ReactNode } from 'react';
import { framedBorder } from '../lib/theme.js';
import { PARTICIPANTS_WIDTH } from './participant-list.js';
import { Line, Rule } from './text.js';

/** The chat pane takes what the terminal has left; the people pane its fixed width. */
const CHAT = { flexGrow: 1, flexBasis: 0 } as const;
const PEOPLE = { width: PARTICIPANTS_WIDTH } as const;

/**
 * The room's body: the chat on the left, as wide as the terminal allows; the participants
 * on the right at the width they need. The rules above and below are built from the same two
 * sizes as the row between them, so their `┬` and `┴` sit on the divider's column whatever
 * the width.
 *
 * The divider is the chat pane's own right border, and a child may draw over its parent's
 * border because Ink draws the border first — which is how a `Rule` inside the chat pane ends
 * in a `┤` on it. A `Rule` in the people pane reaches the divider too, since the divider is
 * the column immediately left of that pane, but only from a box with no horizontal padding:
 * the rule bleeds one column each way and a padding of one cancels it exactly, leaving the
 * junctions stranded a cell inside (`participant-list.tsx` pads its rows for that reason).
 */
export function SplitPanes({ chat, people }: { chat: ReactNode; people: ReactNode }) {
  return (
    <>
      <Rule>
        <Line {...CHAT} end="┬" />
        <Line {...PEOPLE} />
      </Rule>
      <Box flexGrow={1} flexBasis={0} overflowY="hidden">
        <Box
          flexDirection="column"
          {...CHAT}
          borderStyle="single"
          borderLeft={false}
          borderTop={false}
          borderBottom={false}
          {...framedBorder}
        >
          {chat}
        </Box>
        <Box flexDirection="column" {...PEOPLE} flexShrink={0}>
          {people}
        </Box>
      </Box>
      <Rule>
        <Line {...CHAT} end="┴" />
        <Line {...PEOPLE} />
      </Rule>
    </>
  );
}
