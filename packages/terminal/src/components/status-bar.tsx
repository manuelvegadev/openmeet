import { Box } from 'ink';
import { type KeyHint, KeyHints } from './key-hints.js';

/** What pressing the key would do to that peer's window, or null when it would do nothing. */
export type PeerWindowAction = 'watch' | 'close' | null;

interface StatusBarProps {
  isMuted: boolean;
  isVideoMuted?: boolean;
  /** Without the ffmpeg pipeline there is no screen share, so `s` is not drawn (the room log says why). */
  videoEnabled?: boolean;
  webcamEnabled?: boolean;
  isScreenSharing?: boolean;
  debugMode?: boolean;
  /** `w` against the selected peer. Mirrors the key handler, so a visible button always works. */
  peerCam?: PeerWindowAction;
  /** `e` against the selected peer. */
  peerScreen?: PeerWindowAction;
}

export function StatusBar({
  isMuted,
  isVideoMuted,
  videoEnabled = true,
  webcamEnabled,
  isScreenSharing,
  debugMode = false,
  peerCam = null,
  peerScreen = null,
}: StatusBarProps) {
  // What is always here comes first, so the bar's left half stays put and only its tail
  // changes as you move down the participant list.
  const hints: KeyHint[] = [
    { key: 'esc', label: 'leave' },
    { key: 'tab', label: 'chat' },
    { key: 'm', label: isMuted ? 'unmute' : 'mute' },
    { key: '↑↓', label: 'select' },
    { key: '-/+', label: 'vol' },
  ];
  if (videoEnabled) hints.push({ key: 's', label: isScreenSharing ? 'stop sharing' : 'share screen' });
  if (webcamEnabled) hints.push({ key: 'v', label: isVideoMuted ? 'share cam' : 'stop cam' });

  // Then what depends on the peer you have selected.
  if (peerCam) hints.push({ key: 'w', label: `${peerCam} cam` });
  if (peerScreen) hints.push({ key: 'e', label: `${peerScreen} screen` });
  if (debugMode) hints.push({ key: 'g', label: 'debug' });

  return (
    <Box paddingX={1}>
      <KeyHints hints={hints} />
    </Box>
  );
}
