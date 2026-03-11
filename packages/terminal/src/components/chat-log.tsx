import type { ChatMessage } from '@openmeet/shared';
import { Box, Text } from 'ink';

const COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const;

function usernameColor(name: string): (typeof COLORS)[number] {
  let hash = 0;
  for (const char of name) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

interface ChatLogProps {
  messages: ChatMessage[];
}

export function ChatLog({ messages }: ChatLogProps) {
  const visible = messages.slice(-20);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} justifyContent="flex-end">
      {visible.length === 0 ? (
        <Text dimColor>No messages yet</Text>
      ) : (
        visible.map((msg, i) => (
          <Box key={msg.id || i}>
            <Text dimColor>[{formatTime(msg.timestamp)}] </Text>
            <Text color={usernameColor(msg.username)} bold>
              {msg.username}
            </Text>
            <Text>: {msg.content}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
