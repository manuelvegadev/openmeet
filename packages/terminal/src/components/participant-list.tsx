import type { Participant } from '@openmeet/shared';
import { Box } from 'ink';
import stringWidth from 'string-width';
import type { ConnectionStats } from '../hooks/use-room.js';
import { VU_BAR_COUNT } from '../lib/audio/constants.js';
import { NAME_MAX_CELLS } from '../lib/identity.js';
import { theme } from '../lib/theme.js';
import { VuMeter } from './level-bar.js';
import { Name } from './name.js';
import { Divider, POINTER, Pointer, Text } from './text.js';

/**
 * The column's width, from the widest line it can ever hold, so nothing wraps and the chat
 * — the flexible side — never reflows when a tag appears. The widest is a remote peer with
 * every tag, a name at `NAME_MAX_CELLS`, three-digit numbers and a volume other than 100%.
 * Measured with the same `string-width` Ink lays text out with, so a wide character counts
 * its two cells.
 */
/**
 * The state tags: one letter each, run together, no background — `mcs` beside the name. The
 * letter says which state, its colour repeats that (mute orange, cam purple, screen blue),
 * and its case says whether you have that peer's window open on your side: lower while they
 * send, upper while you watch. Three cells at most, and brackets stay a name's alone.
 *
 * Not padded into fixed columns: names differ in length, so the tags never line up anyway,
 * and a blank column for a state nobody has is three cells of nothing on every row.
 */
const TAG = { muted: 'm', cam: 'c', scr: 's' } as const;

function Tag({ letter, color, watching = false }: { letter: string; color: string; watching?: boolean }) {
  return <Text color={color}>{watching ? letter.toUpperCase() : letter}</Text>;
}

const LONGEST_NAME = `[${'M'.repeat(NAME_MAX_CELLS)}]`;
const METER = '█'.repeat(VU_BAR_COUNT);
const ALL_TAGS = `${TAG.muted}${TAG.cam}${TAG.scr}`;
const WIDEST_PEER_LINE = `○ ${POINTER} ${LONGEST_NAME} ${ALL_TAGS} ↓999k ~999ms 60% ${METER}`;
const WIDEST_LOCAL_LINE = `○ ${LONGEST_NAME} ${ALL_TAGS} ↑999k ${METER}`;
const PADDING = 1;
export const PARTICIPANTS_WIDTH = Math.max(stringWidth(WIDEST_PEER_LINE), stringWidth(WIDEST_LOCAL_LINE)) + 2 * PADDING;

interface ParticipantListProps {
  participants: Participant[];
  username: string;
  color: string;
  isMuted: boolean;
  isVideoMuted: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  remoteMuteStates: Record<string, boolean>;
  remoteVideoMuteStates: Record<string, boolean>;
  remoteScreenShareStates: Record<string, boolean>;
  peerVideoOpen: Record<string, boolean>;
  peerScreenOpen: Record<string, boolean>;
  speakingStates: Record<string, boolean>;
  audioLevels: Record<string, number>;
  peerVolumes: Record<string, number>;
  selectedPeerIdx: number;
  connectionStats: ConnectionStats | null;
}

/**
 * The participants column, one line per person: speaking dot, selection marker, name and
 * tags on the left; numbers and the meter on the right, meter last so they line up down the
 * column. You come first, set apart by a blank line, with no "(you)" — being first and
 * having no marker is the tell.
 *
 * The tags carry two things at once: which state (the letter and its colour) and whether you
 * are watching that peer (its case). The bar below says what `w`/`e` would do to the selected
 * peer, so neither has to be read alone.
 */
export function ParticipantList({
  participants,
  username,
  color,
  isMuted,
  isVideoMuted,
  videoEnabled,
  isScreenSharing,
  remoteMuteStates,
  remoteVideoMuteStates,
  remoteScreenShareStates,
  peerVideoOpen,
  peerScreenOpen,
  speakingStates,
  audioLevels,
  peerVolumes,
  selectedPeerIdx,
  connectionStats,
}: ParticipantListProps) {
  const localSpeaking = speakingStates.__local__ && !isMuted;

  return (
    <Box flexDirection="column" paddingX={PADDING}>
      <Box justifyContent="space-between">
        <Text>
          <Text color={localSpeaking ? theme.ok : theme.text}>{localSpeaking ? '● ' : '○ '}</Text>
          <Name name={username} color={color} />
          {/* Your own tags are always lower: there is no watching yourself. */}
          {(isMuted || (videoEnabled && !isVideoMuted) || isScreenSharing) && <Text> </Text>}
          {isMuted && <Tag letter={TAG.muted} color={theme.warn} />}
          {videoEnabled && !isVideoMuted && <Tag letter={TAG.cam} color={theme.accentAlt} />}
          {isScreenSharing && <Tag letter={TAG.scr} color={theme.info} />}
        </Text>
        <Text>
          {connectionStats && <Text dimColor>↑{connectionStats.sendBitrateKbps}k </Text>}
          <VuMeter level={audioLevels.__local__ ?? 0} />
        </Text>
      </Box>
      {/* Deliberately a `Divider` and not a `Rule`: this separates you from the rest inside
          the column, so it stays clear of the frame and the panes' divider. */}
      <Divider />
      {participants.map((p, idx) => {
        const speaking = speakingStates[p.id] && !remoteMuteStates[p.id];
        const isSelected = idx === selectedPeerIdx;
        const level = audioLevels[p.id] ?? 0;
        const vol = peerVolumes[p.id] ?? 1;
        const peerRecvKbps = connectionStats?.peerRecvBitrateKbps[p.id];
        const latency = connectionStats?.peerLatencyMs[p.id];
        const latencyColor =
          latency != null ? (latency > 150 ? theme.danger : latency > 80 ? theme.warn : undefined) : undefined;
        return (
          <Box key={p.id} justifyContent="space-between">
            <Text>
              <Text color={speaking ? theme.ok : theme.text}>{speaking ? '● ' : '○ '}</Text>
              <Pointer on={isSelected} /> <Name name={p.username} color={p.color} />
              {(remoteMuteStates[p.id] || remoteVideoMuteStates[p.id] === false || remoteScreenShareStates[p.id]) && (
                <Text> </Text>
              )}
              {remoteMuteStates[p.id] && <Tag letter={TAG.muted} color={theme.warn} />}
              {remoteVideoMuteStates[p.id] === false && (
                <Tag letter={TAG.cam} color={theme.accentAlt} watching={peerVideoOpen[p.id]} />
              )}
              {remoteScreenShareStates[p.id] && (
                <Tag letter={TAG.scr} color={theme.info} watching={peerScreenOpen[p.id]} />
              )}
            </Text>
            <Text>
              {peerRecvKbps !== undefined && <Text dimColor>↓{peerRecvKbps}k </Text>}
              {latency != null && (
                <Text dimColor={latencyColor == null} color={latencyColor}>
                  ~{latency}ms{' '}
                </Text>
              )}
              {vol !== 1 && <Text dimColor>{Math.round(vol * 100)}% </Text>}
              <VuMeter level={level} volume={vol} />
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
