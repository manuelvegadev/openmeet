import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useEffect, useRef, useState } from 'react';
import { useRoom } from '../hooks/use-room.js';
import { MicTester, playTestTone } from '../lib/audio-test.js';
import type { AudioDevice, DeviceEnvs } from '../lib/devices.js';
import { getDeviceEnv, listAudioDevices } from '../lib/devices.js';
import { saveSettings } from '../lib/settings.js';
import { ChatInput } from './chat-input.js';
import { ChatLog } from './chat-log.js';
import { ParticipantList } from './participant-list.js';
import { RoomLog } from './room-log.js';
import { StatusBar } from './status-bar.js';

const BAR_WIDTH = 30;
const MAX_RMS = 8000;

function renderBar(level: number): string {
  const normalized = Math.min(level / MAX_RMS, 1);
  const filled = Math.round(normalized * BAR_WIDTH);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);
}

function barColor(level: number): string {
  const normalized = Math.min(level / MAX_RMS, 1);
  if (normalized > 0.75) return 'red';
  if (normalized > 0.4) return 'yellow';
  return 'green';
}

interface RoomViewProps {
  serverUrl: string;
  roomId: string;
  username: string;
  version: string;
  deviceEnvs: DeviceEnvs;
  videoEnabled?: boolean;
  videoDevice?: string;
  debug?: boolean;
  onBack: () => void;
}

type DevicePickerStep = null | 'loading' | 'input' | 'output' | 'test';

export function RoomView({
  serverUrl,
  roomId,
  username,
  version,
  deviceEnvs,
  videoEnabled,
  videoDevice,
  debug = false,
  onBack,
}: RoomViewProps) {
  const room = useRoom({ serverUrl, roomId, username, deviceEnvs, debug, videoEnabled, videoDevice });
  const [inputFocused, setInputFocused] = useState(true);
  const [deviceStep, setDeviceStep] = useState<DevicePickerStep>(null);
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({
    inputs: [],
    outputs: [],
  });
  const [selectedInput, setSelectedInput] = useState<AudioDevice | undefined>();
  const [selectedOutput, setSelectedOutput] = useState<AudioDevice | undefined>();
  const [micLevel, setMicLevel] = useState(0);
  const [selectedPeerIdx, setSelectedPeerIdx] = useState(0);
  const testerRef = useRef<MicTester | null>(null);
  const smoothedRef = useRef(0);

  // Load devices when picker opens
  useEffect(() => {
    if (deviceStep === 'loading') {
      listAudioDevices().then((d) => {
        setDevices(d);
        setDeviceStep(d.inputs.length > 0 ? 'input' : d.outputs.length > 0 ? 'output' : null);
      });
    }
  }, [deviceStep]);

  // Mic tester lifecycle — active only during 'test' step
  useEffect(() => {
    if (deviceStep !== 'test') {
      testerRef.current?.stop();
      testerRef.current = null;
      smoothedRef.current = 0;
      setMicLevel(0);
      return;
    }

    const envs = getDeviceEnv(selectedInput, selectedOutput);
    const tester = new MicTester();
    testerRef.current = tester;

    let lastUpdate = 0;
    tester.setLevelCallback((rms) => {
      smoothedRef.current = smoothedRef.current * 0.7 + rms * 0.3;
      const now = Date.now();
      if (now - lastUpdate > 80) {
        lastUpdate = now;
        setMicLevel(smoothedRef.current);
      }
    });

    tester.start(envs);

    return () => {
      tester.stop();
    };
  }, [deviceStep, selectedInput, selectedOutput]);

  const applyDevices = (newInput?: AudioDevice, newOutput?: AudioDevice) => {
    saveSettings({
      audioInputId: newInput?.id ?? null,
      audioOutputId: newOutput?.id ?? null,
      devicesConfigured: true,
    });
    const newEnvs = getDeviceEnv(newInput, newOutput);
    room.updateDevices(newEnvs);
    setDeviceStep(null);
  };

  useInput((input, key) => {
    // Device picker open — handle its keybindings
    if (deviceStep && deviceStep !== 'loading') {
      if (deviceStep === 'test') {
        if (input === 't') {
          const envs = getDeviceEnv(selectedInput, selectedOutput);
          playTestTone(envs);
          return;
        }
        if (key.return) {
          applyDevices(selectedInput, selectedOutput);
          return;
        }
        if (key.escape) {
          setDeviceStep('input');
          return;
        }
        return;
      }
      // input/output steps — only Escape
      if (key.escape) {
        setDeviceStep(null);
      }
      return;
    }

    if (key.escape) {
      room.leave();
      onBack();
      return;
    }
    if (key.tab) {
      setInputFocused((prev) => !prev);
      return;
    }
    if (!inputFocused) {
      if (input === 'm') {
        room.toggleMute();
      }
      if (input === 'v' && room.videoEnabled) {
        room.toggleVideo();
      }
      if (input === 'd') {
        setDeviceStep('loading');
      }
      if (input === 'o') {
        room.toggleOverlay();
      }
      if (input === 'w') {
        const peerId = room.participants[selectedPeerIdx]?.id;
        if (peerId) {
          room.togglePeerVideo(peerId);
        }
      }
      if (input === 'g') {
        room.toggleDebug();
      }
      if (key.upArrow) {
        setSelectedPeerIdx((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setSelectedPeerIdx((prev) => Math.min(room.participants.length - 1, prev + 1));
      }
      if (input === '[' || input === '-') {
        const peerId = room.participants[selectedPeerIdx]?.id;
        if (peerId) {
          const current = room.peerVolumes[peerId] ?? 1;
          room.setPeerVolume(peerId, Math.round((current - 0.02) * 100) / 100);
        }
      }
      if (input === ']' || input === '=' || input === '+') {
        const peerId = room.participants[selectedPeerIdx]?.id;
        if (peerId) {
          const current = room.peerVolumes[peerId] ?? 1;
          room.setPeerVolume(peerId, Math.round((current + 0.02) * 100) / 100);
        }
      }
    }
  });

  // Device picker overlay
  if (deviceStep && deviceStep !== 'loading') {
    if (deviceStep === 'test') {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
          <Text bold color="blue">
            Audio Test
          </Text>
          <Box height={1} overflow="hidden">
            <Text dimColor>{'─'.repeat(200)}</Text>
          </Box>
          <Text>
            Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
          </Text>
          <Text>
            Output: <Text bold>{selectedOutput?.name ?? 'System Default'}</Text>
          </Text>
          <Text />
          <Text bold>Mic level:</Text>
          <Text>
            <Text color={barColor(micLevel)}>{renderBar(micLevel)}</Text>
          </Text>
          <Text />
          <Text dimColor>[t] play test tone [Enter] confirm [Esc] re-select</Text>
        </Box>
      );
    }

    const inputItems = [
      { label: 'System Default', value: '__default__' },
      ...devices.inputs.map((d) => ({ label: d.name, value: d.id })),
    ];
    const outputItems = [
      { label: 'System Default', value: '__default__' },
      ...devices.outputs.map((d) => ({ label: d.name, value: d.id })),
    ];

    if (deviceStep === 'input') {
      return (
        <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
          <Text bold color="blue">
            Change Audio Device
          </Text>
          <Box height={1} overflow="hidden">
            <Text dimColor>{'─'.repeat(200)}</Text>
          </Box>
          <Text bold>Input (Microphone):</Text>
          <SelectInput
            items={inputItems}
            onSelect={(item) => {
              const device = devices.inputs.find((d) => d.id === item.value);
              setSelectedInput(device);
              if (devices.outputs.length === 0) {
                setSelectedOutput(undefined);
                setDeviceStep('test');
              } else {
                setDeviceStep('output');
              }
            }}
          />
          <Text />
          <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        <Text bold color="blue">
          Change Audio Device
        </Text>
        <Box height={1} overflow="hidden">
          <Text dimColor>{'─'.repeat(200)}</Text>
        </Box>
        <Text>
          Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
        </Text>
        <Text />
        <Text bold>Output (Speakers):</Text>
        <SelectInput
          items={outputItems}
          onSelect={(item) => {
            const device = devices.outputs.find((d) => d.id === item.value);
            setSelectedOutput(device);
            setDeviceStep('test');
          }}
        />
        <Text />
        <Text dimColor>[↑↓] navigate [Enter] select [Esc] cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} gap={1} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color="blue">
            OpenMeet <Text dimColor>v{version}</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>
            Room: <Text bold>{roomId}</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>{room.participants.length + 1}p</Text>
        </Box>
        <Box gap={1}>
          {room.connectionStats ? (
            <>
              <Text color="green">↑{room.connectionStats.sendBitrateKbps}k</Text>
              <Text color="cyan">↓{room.connectionStats.recvBitrateKbps}k</Text>
              <Text dimColor>|</Text>
              <Text
                color={
                  room.connectionStats.rttMs > 150 ? 'red' : room.connectionStats.rttMs > 80 ? 'yellow' : undefined
                }
              >
                RTT:{room.connectionStats.rttMs}ms
              </Text>
              <Text
                color={
                  room.connectionStats.packetLossPercent > 5
                    ? 'red'
                    : room.connectionStats.packetLossPercent > 1
                      ? 'yellow'
                      : undefined
                }
              >
                Loss:{room.connectionStats.packetLossPercent}%
              </Text>
              <Text dimColor>|</Text>
            </>
          ) : null}
          <Text color={room.connected ? 'green' : 'red'}>●</Text>
        </Box>
      </Box>
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>

      {deviceStep === 'loading' && (
        <Box paddingX={1}>
          <Text color="yellow">Loading audio devices...</Text>
        </Box>
      )}

      {/* Participants */}
      <ParticipantList
        participants={room.participants}
        myId={room.myId}
        username={username}
        isMuted={room.isMuted}
        remoteMuteStates={room.remoteMuteStates}
        remoteVideoMuteStates={room.remoteVideoMuteStates}
        remoteScreenShareStates={room.remoteScreenShareStates}
        peerVideoOpen={room.peerVideoOpen}
        speakingStates={room.speakingStates}
        audioLevels={room.audioLevels}
        peerVolumes={room.peerVolumes}
        selectedPeerIdx={selectedPeerIdx}
        connectionStats={room.connectionStats}
      />
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>

      {/* Chat + Room Log — split horizontally */}
      <Box flexGrow={1} flexBasis={0} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} flexBasis="50%">
          <ChatLog messages={room.chatMessages} />
        </Box>
        <Box
          flexDirection="column"
          flexGrow={1}
          flexBasis="50%"
          borderStyle="single"
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderDimColor
        >
          <RoomLog events={room.roomEvents} joinedAt={room.joinedAt} />
        </Box>
      </Box>
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>

      {/* Input */}
      <ChatInput focused={inputFocused} onSend={room.sendMessage} />
      <Box height={1} overflow="hidden">
        <Text dimColor>{'─'.repeat(200)}</Text>
      </Box>

      {/* Status */}
      <StatusBar
        isMuted={room.isMuted}
        isVideoMuted={room.isVideoMuted}
        videoEnabled={room.videoEnabled}
        overlayEnabled={room.overlayEnabled}
        connected={room.connected}
        debugMode={room.debugMode}
      />

      {/* Error */}
      {room.error && (
        <Box paddingX={1}>
          <Text color="red">Error: {room.error}</Text>
        </Box>
      )}
    </Box>
  );
}
