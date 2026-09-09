import type { Participant } from '@openmeet/shared';
import { Box } from 'ink';
import stringWidth from 'string-width';
import type { ConnectionStats } from '../hooks/use-room.js';
import { VU_BAR_COUNT } from '../lib/audio/constants.js';
import { NAME_MAX_CELLS } from '../lib/identity.js';
import { theme } from '../lib/theme.js';
import { VuMeter } from './level-bar.js';
import { Name } from './name.js';
import { POINTER, Pointer, Text } from './text.js';

/**
 * The column's width, from the widest line it can ever hold, so nothing wraps and the chat
 * — the flexible side — never reflows when a tag appears. The widest is a remote peer with
 * every tag, a name at `NAME_MAX_CELLS`, three-digit numbers and a volume other than 100%.
 * Measured with the same `string-width` Ink lays text out with, so a wide character counts
 * its two cells.
 */
/** The tag words, written once so the width below and the rows draw the same strings. */
const TAG = { muted: 'muted', cam: 'cam', scr: 'scr', sharing: 'sharing' } as const;
/** A tag as drawn: the word with a cell of its background either side. */
const chip = (label: string) => ` ${label} `;
const LONGEST_NAME = `[${'M'.repeat(NAME_MAX_CELLS)}]`;
const METER = '█'.repeat(VU_BAR_COUNT);
const WIDEST_PEER_LINE = `○ ${POINTER} ${LONGEST_NAME} ${chip(TAG.muted)} ${chip(TAG.cam)} ${chip(TAG.scr)} ↓999k ~999ms 60% ${METER}`;
const WIDEST_LOCAL_LINE = `○ ${LONGEST_NAME} ${chip(TAG.muted)} ${chip(TAG.cam)} ${chip(TAG.sharing)} ↑999k ${METER}`;

/**
 * A state tag: the word on its colour, dark text, like the bar's buttons. Brackets are for
 * names and nothing else, so a tag is told from a name at a glance. A peer's `cam` and `scr`
 * go green once you have that window open on your side.
 */
function Tag({ label, color }: { label: string; color: string }) {
  return (
    <Text backgroundColor={color} color={theme.onAccent}>
      {chip(label)}
    </Text>
  );
}
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
 * A peer's `cam` and `scr` tags carry two states in their colour: the tag's own colour while
 * they are sending, green once you have that window open on your side. The bar below says
 * what `w`/`e` would do to the selected peer, so the colour never has to be read alone.
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
      <Text bold>Participants</Text>
      <Box justifyContent="space-between">
        <Text>
          <Text color={localSpeaking ? theme.ok : theme.text}>{localSpeaking ? '● ' : '○ '}</Text>
          <Name name={username} color={color} />
          {isMuted && (
            <>
              {' '}
              <Tag label={TAG.muted} color={theme.warn} />
            </>
          )}
          {videoEnabled && !isVideoMuted && (
            <>
              {' '}
              <Tag label={TAG.cam} color={theme.accentAlt} />
            </>
          )}
          {isScreenSharing && (
            <>
              {' '}
              <Tag label={TAG.sharing} color={theme.danger} />
            </>
          )}
        </Text>
        <Text>
          {connectionStats && <Text dimColor>↑{connectionStats.sendBitrateKbps}k </Text>}
          <VuMeter level={audioLevels.__local__ ?? 0} />
        </Text>
      </Box>
      {participants.length > 0 && <Text> </Text>}
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
              {remoteMuteStates[p.id] && (
                <>
                  {' '}
                  <Tag label={TAG.muted} color={theme.warn} />
                </>
              )}
              {remoteVideoMuteStates[p.id] === false && (
                <>
                  {' '}
                  <Tag label={TAG.cam} color={peerVideoOpen[p.id] ? theme.ok : theme.accentAlt} />
                </>
              )}
              {remoteScreenShareStates[p.id] && (
                <>
                  {' '}
                  <Tag label={TAG.scr} color={peerScreenOpen[p.id] ? theme.ok : theme.info} />
                </>
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
