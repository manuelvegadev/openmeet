import type { Participant } from '@openmeet/shared';
import { Box } from 'ink';
import type { ConnectionStats } from '../hooks/use-room.js';
import { theme } from '../lib/theme.js';
import { VuMeter } from './level-bar.js';
import { Text } from './text.js';

interface ParticipantListProps {
  participants: Participant[];
  myId: string | null;
  username: string;
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

export function ParticipantList({
  participants,
  username,
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
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Participants:</Text>
      <Box paddingLeft={1} justifyContent="space-between">
        <Text>
          <Text color={localSpeaking ? theme.ok : theme.text}>{localSpeaking ? '● ' : '○ '}</Text>
          <Text>{username} (you)</Text>
          {isMuted && <Text color={theme.warn}> [muted]</Text>}
          {videoEnabled && !isVideoMuted && <Text color={theme.accentAlt}> [cam]</Text>}
          {isScreenSharing && <Text color={theme.danger}> [sharing]</Text>}
        </Text>
        <Box>
          <Text dimColor>48kHz stereo{connectionStats ? ` ↑${connectionStats.sendBitrateKbps}k` : ''} </Text>
          <VuMeter level={audioLevels.__local__ ?? 0} />
        </Box>
      </Box>
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
          <Box key={p.id} paddingLeft={1} justifyContent="space-between">
            <Text>
              <Text color={speaking ? theme.ok : theme.text}>{speaking ? '● ' : '○ '}</Text>
              <Text color={theme.accent}>{isSelected ? '> ' : '  '}</Text>
              <Text>{p.username}</Text>
              {remoteMuteStates[p.id] && <Text color={theme.warn}> [muted]</Text>}
              {remoteVideoMuteStates[p.id] === false && <Text color={theme.accentAlt}> [cam]</Text>}
              {peerVideoOpen[p.id] && <Text color={theme.ok}> [watching]</Text>}
              {remoteScreenShareStates[p.id] && <Text color={theme.info}> [scr]</Text>}
              {peerScreenOpen[p.id] && <Text color={theme.ok}> [viewing scr]</Text>}
            </Text>
            <Box>
              <Text>
                vol:
                {Math.round(vol * 100)
                  .toString()
                  .padStart(3)}
                %{' '}
              </Text>
              {peerRecvKbps !== undefined && <Text dimColor>↓{peerRecvKbps}k </Text>}
              {latency != null && (
                <Text dimColor={latencyColor == null} color={latencyColor}>
                  ~{latency}ms{' '}
                </Text>
              )}
              <VuMeter level={level} volume={vol} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
