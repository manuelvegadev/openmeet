import { Box, Text } from 'ink';

interface StatusBarProps {
  isMuted: boolean;
  isVideoMuted?: boolean;
  videoEnabled?: boolean;
  isScreenSharing?: boolean;
  debugMode?: boolean;
}

export function StatusBar({ isMuted, isVideoMuted, videoEnabled, isScreenSharing, debugMode = false }: StatusBarProps) {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        [Esc] Leave [Tab] Chat [m] {isMuted ? 'unmute' : 'mute'}
        {videoEnabled ? ` [v] cam ${isVideoMuted ? 'on' : 'off'}` : ''} [s] {isScreenSharing ? 'stop' : 'share'}
        {videoEnabled ? ` [w] watch [e] screen` : ''} [↑↓] Select [[-]/[+]] Vol
      </Text>
      {debugMode && <Text color="magenta"> [g] DBG</Text>}
    </Box>
  );
}
