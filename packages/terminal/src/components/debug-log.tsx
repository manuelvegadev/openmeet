import { Box } from 'ink';
import type { RoomEvent } from '../hooks/use-room.js';
import { formatClock } from '../lib/clock.js';
import { theme } from '../lib/theme.js';
import { Text } from './text.js';

/**
 * The debug lines, and only those — everything else the room reports goes into the chat.
 * Shown under the participants while debug mode is on (`g`); with `--debug` there is a line
 * every few seconds, which is exactly why they do not share the conversation.
 */
export function DebugLog({ events }: { events: RoomEvent[] }) {
  const visible = events.filter((e) => e.type === 'debug').slice(-30);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} flexBasis={0} overflow="hidden">
      <Text bold>Debug</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
        {visible.length === 0 ? (
          <Text dimColor>Nothing yet</Text>
        ) : (
          visible.map((event) => (
            <Text key={event.id}>
              <Text dimColor>[{formatClock(event.timestamp, true)}] </Text>
              <Text color={theme.accentAlt}>{event.message}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
