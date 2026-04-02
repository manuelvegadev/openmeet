import { Box, Text } from 'ink';

interface StatusBarProps {
  isMuted: boolean;
  isVideoMuted?: boolean;
  videoEnabled?: boolean;
  overlayEnabled?: boolean;
  connected: boolean;
  debugMode?: boolean;
}

export function StatusBar({
  isMuted,
  isVideoMuted,
  videoEnabled,
  overlayEnabled,
  connected,
  debugMode = false,
}: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text dimColor>
          [Esc] Leave [Tab] Chat [m] {isMuted ? 'unmute' : 'mute'}
          {videoEnabled ? ` [v] cam ${isVideoMuted ? 'on' : 'off'}` : ''}
          {videoEnabled ? ` [w] watch` : ''} [o] overlay [↑↓] Select [[-]/[+]] Vol
        </Text>
        {debugMode && <Text color="magenta">[g] DBG</Text>}
      </Box>
      <Text color={connected ? 'green' : 'red'}>{connected ? '\u{25CF} Connected' : '\u{25CB} Disconnected'}</Text>
    </Box>
  );
}
