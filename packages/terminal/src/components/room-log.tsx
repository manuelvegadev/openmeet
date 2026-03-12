import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import type { RoomEvent } from '../hooks/use-room.js';

const EVENT_COLORS: Record<RoomEvent['type'], string> = {
  join: 'green',
  leave: 'red',
  screen: 'cyan',
  mute: 'yellow',
  info: 'blue',
  debug: 'magenta',
};

const EVENT_ICONS: Record<RoomEvent['type'], string> = {
  join: '+',
  leave: '-',
  screen: '▣',
  mute: '♪',
  info: '·',
  debug: '·',
};

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

interface RoomLogProps {
  events: RoomEvent[];
  joinedAt: number | null;
}

export function RoomLog({ events, joinedAt }: RoomLogProps) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!joinedAt) return;
    const update = () => setElapsed(formatElapsed(Date.now() - joinedAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [joinedAt]);

  const visible = events.slice(-30);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box justifyContent="space-between">
        <Text bold>Room Log</Text>
        {elapsed && <Text dimColor>in room: {elapsed}</Text>}
      </Box>
      <Box flexDirection="column" flexGrow={1} justifyContent="flex-end">
        {visible.length === 0 ? (
          <Text dimColor>No events yet</Text>
        ) : (
          visible.map((event) => (
            <Box key={`${event.timestamp}-${event.message}`}>
              <Text dimColor>[{formatTime(event.timestamp)}] </Text>
              {event.type === 'debug' ? (
                <Text color="magenta" dimColor>
                  [DBG] {event.message}
                </Text>
              ) : (
                <Text color={EVENT_COLORS[event.type]}>
                  {EVENT_ICONS[event.type]} {event.message}
                </Text>
              )}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
