import { Box, Text } from 'ink';

interface StatusBarProps {
  isMuted: boolean;
  connected: boolean;
}

export function StatusBar({ isMuted, connected }: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text dimColor>
        [Esc] Leave [Tab] Chat [m] {isMuted ? 'unmute' : 'mute'} [d] Devices [↑↓] Select [[-]/[+]] Vol
      </Text>
      <Text color={connected ? 'green' : 'red'}>{connected ? '\u{25CF} Connected' : '\u{25CB} Disconnected'}</Text>
    </Box>
  );
}
