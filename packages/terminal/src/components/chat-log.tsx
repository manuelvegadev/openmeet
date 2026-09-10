import type { ChatMessage } from '@openmeet/shared';
import { Box, useInput, useWindowSize } from 'ink';
import { useState } from 'react';
import type { RoomEvent } from '../hooks/use-room.js';
import { formatClock } from '../lib/clock.js';
import { theme } from '../lib/theme.js';
import { Name } from './name.js';
import { Text } from './text.js';

/**
 * What kind of line it is: a message someone typed, or something that happened in the room
 * — a join, a share starting, an error. They share the stream, in time order, the way a chat
 * client folds "X joined" into the channel: the events are context for the messages, not a
 * channel of their own. Debug lines never come here; they have their own panel.
 */
export type LineKind = 'message' | Exclude<RoomEvent['type'], 'debug'>;

/** One line of the conversation. */
export interface ChatEntry {
  key: string;
  timestamp: number;
  kind: LineKind;
  /** Who it is about — the sender, or the participant an event names — and their colour. */
  who?: string;
  color?: string;
  text: string;
}

const fromMessage = (m: ChatMessage): ChatEntry => ({
  key: `m-${m.id}`,
  timestamp: m.timestamp,
  kind: 'message',
  who: m.username,
  color: m.color,
  text: m.content,
});

const fromEvent = (e: RoomEvent): ChatEntry => ({
  key: `e-${e.id}`,
  timestamp: e.timestamp,
  kind: e.type as LineKind,
  who: e.who,
  color: e.color,
  text: e.message,
});

/**
 * Fold messages and room events into one stream, oldest first. Each input arrives in time
 * order already (the server stamps messages, the engine stamps events), so this is a merge,
 * not a sort.
 */
export function mergeChat(messages: ChatMessage[], events: RoomEvent[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < messages.length || j < events.length) {
    const e = events[j];
    if (e?.type === 'debug') {
      j++;
      continue;
    }
    const m = messages[i];
    if (m && (!e || m.timestamp <= e.timestamp)) {
      out.push(fromMessage(m));
      i++;
    } else if (e) {
      out.push(fromEvent(e));
      j++;
    }
  }
  return out;
}

/**
 * Every line has the same shape — `[time] icon [who] what` — and the icon says what kind of
 * line it is, in that kind's colour: `›` a message, `+` someone here, `-` someone gone,
 * `▣` a screen share, `♪` a mute, `·` a notice. `who` is `[name]` in that person's colour,
 * one space before the text; a notice about nobody goes straight from the icon to the text.
 */
const ICONS: Record<LineKind, string> = { message: '›', join: '+', leave: '-', screen: '▣', mute: '♪', info: '·' };
const ICON_COLORS: Record<LineKind, string> = {
  message: theme.muted,
  join: theme.ok,
  leave: theme.danger,
  screen: theme.info,
  mute: theme.warn,
  info: theme.accent,
};

/** How many entries a page key moves. */
const PAGE = 10;

interface ChatLogProps {
  entries: ChatEntry[];
  /**
   * Arrow keys scroll. On while the chat input has the focus — the input ignores ↑/↓, and
   * with the focus elsewhere those keys select a participant. Page Up/Down scroll always.
   */
  arrowsScroll: boolean;
  /** Off while a modal is up: the room's tree stays mounted behind it and must not hear keys. */
  active?: boolean;
}

/**
 * The conversation, following its tail until you scroll.
 *
 * Scrolling is by entry, anchored on the *last visible one*: `anchor` is that entry's index,
 * or null to follow the tail. Anchoring on an absolute index is what keeps the view still
 * when a message arrives while you are reading older ones — a tail-relative offset would
 * shift everything up under your eyes — and the line at the bottom counts what you are not
 * seeing.
 *
 * Layout is Ink's: the entries up to the anchor go into a `justifyContent="flex-end"` box
 * that clips vertically, so the newest sit at the bottom and whatever runs past the top is
 * cut — a long entry shows its tail. Only as many entries as the terminal has rows are
 * handed over, since each takes at least one; that bounds the work without measuring
 * anything. Each entry is one `Text` with the pieces nested inside: Ink sizes a single
 * wrapped Text correctly, whereas a row Box of several Texts keeps a one-row height when one
 * of them wraps and paints the second line over the next entry (gotcha 34).
 */
export function ChatLog({ entries, arrowsScroll, active = true }: ChatLogProps) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const { rows } = useWindowSize();

  const last = entries.length - 1;
  const end = anchor == null ? last : Math.min(anchor, last);
  const below = last - end;

  const scroll = (delta: number) => {
    const next = Math.max(0, end + delta);
    setAnchor(next >= last ? null : next);
  };

  useInput(
    (_input, key) => {
      if (key.pageUp) scroll(-PAGE);
      else if (key.pageDown) scroll(PAGE);
      else if (arrowsScroll && key.upArrow) scroll(-1);
      else if (arrowsScroll && key.downArrow) scroll(1);
    },
    { isActive: active && entries.length > 0 },
  );

  const shown = entries.slice(Math.max(0, end + 1 - rows), end + 1);

  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingX={1} justifyContent="flex-end" overflowY="hidden">
      {entries.length === 0 ? (
        <Text dimColor>No messages yet</Text>
      ) : (
        shown.map((entry) => (
          <Text key={entry.key}>
            <Text dimColor>[{formatClock(entry.timestamp)}] </Text>
            <Text color={ICON_COLORS[entry.kind]}>{ICONS[entry.kind]} </Text>
            {entry.who && <Name name={entry.who} color={entry.color} bold={entry.kind === 'message'} />}
            <Text dimColor={entry.kind !== 'message'}>
              {entry.who ? ' ' : ''}
              {entry.text}
            </Text>
          </Text>
        ))
      )}
      {below > 0 && (
        <Text dimColor>
          ↓ {below} more {below === 1 ? 'entry' : 'entries'} below
        </Text>
      )}
    </Box>
  );
}
