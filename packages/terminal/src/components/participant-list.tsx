import type { Participant } from '@openmeet/shared';
import { Box, Text } from 'ink';
import type { ConnectionStats } from '../hooks/use-room.js';

const BAR_COUNT = 20;
const MAX_RMS = 8000;

function vuColor(level: number, volume: number): string {
  const normalized = Math.min(level / MAX_RMS, 1) * volume;
  if (normalized > 0.75) return 'red';
  if (normalized > 0.4) return 'yellow';
  return 'green';
}

function VuMeter({ level, volume = 1 }: { level: number; volume?: number }) {
  const activeBars = Math.round(volume * BAR_COUNT);
  const normalized = Math.min(level / MAX_RMS, 1);
  const filled = Math.round(normalized * activeBars);
  const emptyActive = activeBars - filled;
  const inactive = BAR_COUNT - activeBars;
  const color = vuColor(level, volume);

  return (
    <Text>
      <Text color={color}>{'\u2588'.repeat(filled)}</Text>
      <Text color="green">{'\u2591'.repeat(emptyActive)}</Text>
      <Text dimColor>{'\u2591'.repeat(inactive)}</Text>
    </Text>
  );
}

interface ParticipantListProps {
  participants: Participant[];
  myId: string | null;
  username: string;
  isMuted: boolean;
  remoteMuteStates: Record<string, boolean>;
  remoteScreenShareStates: Record<string, boolean>;
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
  remoteMuteStates,
  remoteScreenShareStates,
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
          <Text color={localSpeaking ? 'green' : undefined}>{localSpeaking ? '● ' : '○ '}</Text>
          <Text>{username} (you)</Text>
          {isMuted && <Text color="yellow"> [muted]</Text>}
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
          latency != null ? (latency > 150 ? 'red' : latency > 80 ? 'yellow' : undefined) : undefined;
        return (
          <Box key={p.id} paddingLeft={1} justifyContent="space-between">
            <Text>
              <Text color={speaking ? 'green' : undefined}>{speaking ? '● ' : '○ '}</Text>
              <Text color="cyan">{isSelected ? '> ' : '  '}</Text>
              <Text>{p.username}</Text>
              {remoteMuteStates[p.id] && <Text color="yellow"> [muted]</Text>}
              {remoteScreenShareStates[p.id] && <Text color="cyan"> [scr]</Text>}
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
