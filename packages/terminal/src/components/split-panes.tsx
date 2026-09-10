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
 * on the right at the width they need. The rule above — and the one below a `footer`, when
 * there is one — is built from the same two sizes as the row between them, so its `┬` or `┴`
 * sits on the divider's column whatever the width.
 *
 * Without a `footer` the panes end at the frame's own bottom border, and nothing is drawn
 * between them. A rule there used to separate the panes from the bottom bar; once the bar was
 * retired it enclosed nothing, and a rule stacked directly on the border reads as an empty
 * strip — the bar's ghost. The room passes no footer and gets that row back for the
 * conversation; `scripts/chat-demo.tsx` passes its own keys and keeps the rule.
 *
 * The divider is the chat pane's own right border, and a child may draw over its parent's
 * border because Ink draws the border first — which is how a `Rule` inside the chat pane ends
 * in a `┤` on it. A `Rule` in the people pane reaches the divider too, since the divider is
 * the column immediately left of that pane, but only from a box with no horizontal padding:
 * the rule bleeds one column each way and a padding of one cancels it exactly, leaving the
 * junctions stranded a cell inside (`participant-list.tsx` pads its rows for that reason).
 */
/**
 * The room's last line: the frame's own bottom edge, with the divider's `┴` in it.
 *
 * `Rule` reaches the frame's side borders by bleeding a column each way; downwards there is no
 * border to bleed onto, because `FullScreen` leaves its bottom open for this (`closeBottom`).
 * So this line closes the frame itself — the corners are the frame's `╰` and `╯` — and the
 * junction rides in it, mirrored from the same two flex props as every other row here so it
 * lands on the divider's column at any width.
 *
 * A rule *above* the border instead would enclose nothing, which is what the retired bottom bar
 * left behind and what `scripts/room-frame-test.tsx` now pins.
 */
function BottomEdge() {
  return (
    <Rule start="╰" end="╯">
      <Line {...CHAT} end="┴" />
      <Line {...PEOPLE} />
    </Rule>
  );
}

export function SplitPanes({ chat, people, footer }: { chat: ReactNode; people: ReactNode; footer?: ReactNode }) {
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
      {footer !== undefined ? (
        <>
          <Rule>
            <Line {...CHAT} end="┴" />
            <Line {...PEOPLE} />
          </Rule>
          {footer}
        </>
      ) : (
        <BottomEdge />
      )}
    </>
  );
}
