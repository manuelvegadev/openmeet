import { Box } from 'ink';
import { type KeyHint, KeyHints } from './key-hints.js';

/** What pressing the key would do to that peer's window, or null when it would do nothing. */
export type PeerWindowAction = 'watch' | 'close' | null;

/**
 * The room's keys, drawn where the thing they act on is: what you do to yourself under your
 * own row, what you do to the selected peer under the list, the chat's own key beside the
 * input, and the room's settings along the bottom. They live in this one file so the four
 * rows and the key handler in `room-view.tsx` can be read against each other — a drawn button
 * must work, and a working key should be advertised.
 *
 * Every row greys out while the chat input has the focus, because the letters go to the input
 * then; that is what `inputFocused` means everywhere below.
 */

/** Grey the whole row while you are typing, keeping it in place so nothing reflows. */
function row(hints: KeyHint[], inputFocused: boolean): KeyHint[] {
  return inputFocused ? hints.map((h) => ({ ...h, disabled: true })) : hints;
}

interface MyActionsProps {
  isMuted: boolean;
  isVideoMuted?: boolean;
  /** Without the ffmpeg pipeline there is no screen share, so `s` is not drawn (the room log says why). */
  videoEnabled?: boolean;
  webcamEnabled?: boolean;
  isScreenSharing?: boolean;
  inputFocused?: boolean;
}

/** What you do to your own microphone, camera and screen. Sits under your row in the list. */
export function MyActions({
  isMuted,
  isVideoMuted,
  videoEnabled = true,
  webcamEnabled,
  isScreenSharing,
  inputFocused = false,
}: MyActionsProps) {
  const hints: KeyHint[] = [{ key: 'm', label: isMuted ? 'unmute' : 'mute' }];
  if (videoEnabled) hints.push({ key: 's', label: isScreenSharing ? 'stop sharing' : 'share screen' });
  if (webcamEnabled) hints.push({ key: 'v', label: isVideoMuted ? 'share cam' : 'stop cam' });

  return <KeyHints hints={row(hints, inputFocused)} />;
}

interface PeerActionsProps {
  /** No peers: the keys would act on nobody, so the row greys out rather than lying. */
  hasPeers: boolean;
  videoEnabled?: boolean;
  /** `w` against the selected peer. Mirrors the key handler, so a visible button always works. */
  peerCam?: PeerWindowAction;
  /** `e` against the selected peer. */
  peerScreen?: PeerWindowAction;
  inputFocused?: boolean;
}

/**
 * What you do to the peer marked `▸`. Sits under the list, and every key keeps its place and
 * its label whatever that peer is doing: a row that grew, shrank or re-worded itself as you
 * moved down the list would make the list jump, and it has to fit the column. Whether their
 * window is already open is in their tags — `C`, `S` upper-case — not here.
 */
export function PeerActions({
  hasPeers,
  videoEnabled = true,
  peerCam = null,
  peerScreen = null,
  inputFocused = false,
}: PeerActionsProps) {
  const hints: KeyHint[] = [
    { key: '↑↓', label: 'select', disabled: !hasPeers },
    { key: '-/+', label: 'vol', disabled: !hasPeers },
  ];
  if (videoEnabled) {
    hints.push({ key: 'w', label: 'cam', disabled: !peerCam });
    hints.push({ key: 'e', label: 'screen', disabled: !peerScreen });
  }

  return <KeyHints hints={row(hints, inputFocused)} />;
}

interface RoomBarProps {
  debugMode?: boolean;
  inputFocused?: boolean;
}

/** The room's own settings, along the bottom. `d` and `o` used to work without being drawn. */
export function RoomBar({ debugMode = false, inputFocused = false }: RoomBarProps) {
  const hints: KeyHint[] = [
    { key: 'd', label: 'devices' },
    { key: 'o', label: 'overlay' },
    { key: 'g', label: debugMode ? 'hide debug' : 'debug' },
  ];

  return (
    <Box paddingX={1}>
      <KeyHints hints={row(hints, inputFocused)} />
    </Box>
  );
}
