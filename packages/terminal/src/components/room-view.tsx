import { Box, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AudioDevice, type AudioDeviceSelection, listAudioDevices } from '../engine/client.js';
import { useRoom } from '../hooks/use-room.js';
import { MicTester, playTestTone } from '../lib/audio-test.js';
import { listScreenDevices, prefetchScreenDevices, type ScreenDevice } from '../lib/devices.js';
import type { Identity } from '../lib/identity.js';
import { getPlatformSupport } from '../lib/platform.js';
import { saveSettings } from '../lib/settings.js';
import { theme } from '../lib/theme.js';
import { ChatInput } from './chat-input.js';
import { ChatLog, mergeChat } from './chat-log.js';
import { DebugLog } from './debug-log.js';
import { Elapsed } from './elapsed.js';
import { MicBar } from './level-bar.js';
import { ParticipantList } from './participant-list.js';
import { Screen } from './screen.js';
import { Select } from './select.js';
import { SplitPanes } from './split-panes.js';
import { type PeerWindowAction, StatusBar } from './status-bar.js';
import { Rule, Text } from './text.js';

interface RoomViewProps {
  serverUrl: string;
  roomId: string;
  identity: Identity;
  version: string;
  deviceSelection: AudioDeviceSelection;
  videoEnabled?: boolean;
  videoDisabledReason?: string;
  webcamEnabled?: boolean;
  videoDevice?: string;
  debug?: boolean;
  onBack: () => void;
}

type DevicePickerStep = null | 'loading' | 'input' | 'output' | 'test';

const platformName = getPlatformSupport().name;

export function RoomView({
  serverUrl,
  roomId,
  identity,
  version,
  deviceSelection,
  videoEnabled,
  videoDisabledReason,
  webcamEnabled,
  videoDevice,
  debug = false,
  onBack,
}: RoomViewProps) {
  const room = useRoom({
    serverUrl,
    roomId,
    username: identity.name,
    color: identity.color,
    deviceSelection,
    debug,
    videoEnabled,
    videoDisabledReason,
    webcamEnabled,
    videoDevice,
  });
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
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const [screenDeviceList, setScreenDeviceList] = useState<ScreenDevice[]>([]);
  const [lastScreenDevice, setLastScreenDevice] = useState<ScreenDevice | null>(null);
  const testerRef = useRef<MicTester | null>(null);
  const chat = useMemo(() => mergeChat(room.chatMessages, room.roomEvents), [room.chatMessages, room.roomEvents]);

  // Load devices when picker opens
  useEffect(() => {
    prefetchScreenDevices();
  }, []);

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
      setMicLevel(0);
      return;
    }

    const tester = new MicTester();
    testerRef.current = tester;

    let lastUpdate = 0;
    tester.setLevelCallback((rms) => {
      // Already smoothed by the engine's ballistics; just cap the renders.
      const now = Date.now();
      if (now - lastUpdate > 80) {
        lastUpdate = now;
        setMicLevel(rms);
      }
    });

    tester.start({ input: selectedInput, output: selectedOutput });

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
    room.updateDevices({ input: newInput, output: newOutput });
    setDeviceStep(null);
  };

  useInput((input, key) => {
    // Screen picker open — only Escape to cancel
    if (screenPickerOpen) {
      if (key.escape) {
        setScreenPickerOpen(false);
      }
      return;
    }

    // Device picker open — handle its keybindings
    if (deviceStep && deviceStep !== 'loading') {
      if (deviceStep === 'test') {
        if (input === 't') {
          playTestTone({ input: selectedInput, output: selectedOutput });
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
      if (input === 'v' && room.webcamEnabled) {
        room.toggleVideo();
      }
      if (input === 'd') {
        setDeviceStep('loading');
      }
      if (input === 'o') {
        room.toggleOverlay();
      }
      if (input === 's' && room.videoEnabled) {
        if (room.isScreenSharing) {
          room.stopScreenSharing();
          setLastScreenDevice(null);
        } else if (lastScreenDevice) {
          room.startScreenSharing(lastScreenDevice);
        } else {
          // Open screen picker
          const screens = listScreenDevices();
          if (screens.length === 1) {
            // Only one screen — start sharing immediately
            setLastScreenDevice(screens[0]);
            room.startScreenSharing(screens[0]);
          } else if (screens.length > 1) {
            setScreenDeviceList(screens);
            setScreenPickerOpen(true);
          }
        }
      }
      if (input === 'w') {
        const peerId = room.participants[selectedPeerIdx]?.id;
        if (peerId) {
          // Only open if peer has camera on; always allow closing
          if (room.peerVideoOpen[peerId] || room.remoteVideoMuteStates[peerId] === false) {
            room.togglePeerVideo(peerId);
          }
        }
      }
      if (input === 'e') {
        const peerId = room.participants[selectedPeerIdx]?.id;
        if (peerId && room.remoteScreenShareStates[peerId]) {
          room.togglePeerScreen(peerId);
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

  // Screen picker overlay
  if (screenPickerOpen && screenDeviceList.length > 0) {
    const screenItems = screenDeviceList.map((d) => ({
      label: `${d.name}${d.width && d.height ? ` (${d.width}x${d.height})` : ''}`,
      value: d.id,
    }));
    return (
      <Screen title="Screen Share" hints={[{ key: 'esc', label: 'cancel' }]}>
        <Text bold>Select screen to share:</Text>
        <Select
          items={screenItems}
          onSelect={(item) => {
            const device = screenDeviceList.find((d) => d.id === item.value);
            if (device) {
              setLastScreenDevice(device);
              setScreenPickerOpen(false);
              room.startScreenSharing(device);
            }
          }}
        />
      </Screen>
    );
  }

  // Device picker overlay
  if (deviceStep && deviceStep !== 'loading') {
    if (deviceStep === 'test') {
      return (
        <Screen
          title="Audio Test"
          hints={[
            { key: 't', label: 'test tone' },
            { key: 'enter', label: 'confirm' },
            { key: 'esc', label: 're-select' },
          ]}
        >
          <Text>
            Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
          </Text>
          <Text>
            Output: <Text bold>{selectedOutput?.name ?? 'System Default'}</Text>
          </Text>
          <Text bold>Mic level:</Text>
          <Text>
            <MicBar level={micLevel} />
          </Text>
        </Screen>
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
        <Screen
          title="Change Audio Device"
          hints={[
            { key: '↑↓', label: 'navigate' },
            { key: 'enter', label: 'select' },
            { key: 'esc', label: 'cancel' },
          ]}
        >
          <Text bold>Input (Microphone):</Text>
          <Select
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
        </Screen>
      );
    }

    return (
      <Screen
        title="Change Audio Device"
        hints={[
          { key: '↑↓', label: 'navigate' },
          { key: 'enter', label: 'select' },
          { key: 'esc', label: 'cancel' },
        ]}
      >
        <Text>
          Input: <Text bold>{selectedInput?.name ?? 'System Default'}</Text>
        </Text>
        <Text bold>Output (Speakers):</Text>
        <Select
          items={outputItems}
          onSelect={(item) => {
            const device = devices.outputs.find((d) => d.id === item.value);
            setSelectedOutput(device);
            setDeviceStep('test');
          }}
        />
      </Screen>
    );
  }

  // What `w` and `e` would do to the selected peer right now. These duplicate the conditions
  // in the key handlers above — deliberately, and they have to be kept in step: a button that
  // is drawn must work, and a key that works should be advertised.
  const windowAction = (open: boolean, canOpen: boolean): PeerWindowAction =>
    open ? 'close' : canOpen ? 'watch' : null;
  const selectedPeerId = room.videoEnabled ? room.participants[selectedPeerIdx]?.id : undefined;
  const peerCamAction = selectedPeerId
    ? windowAction(room.peerVideoOpen[selectedPeerId], room.remoteVideoMuteStates[selectedPeerId] === false)
    : null;
  const peerScreenAction =
    selectedPeerId && room.remoteScreenShareStates[selectedPeerId]
      ? windowAction(room.peerScreenOpen[selectedPeerId], true)
      : null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} gap={1} justifyContent="space-between">
        <Box gap={1}>
          <Text bold color={theme.accent}>
            OpenMeet <Text dimColor>v{version}</Text> <Text dimColor>({platformName})</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>
            Room: <Text bold>{roomId}</Text>
          </Text>
          <Text dimColor>|</Text>
          <Text>{room.participants.length + 1}p</Text>
          {room.joinedAt && (
            <>
              <Text dimColor>|</Text>
              <Elapsed since={room.joinedAt} />
            </>
          )}
        </Box>
        <Box gap={1}>
          {room.connectionStats ? (
            <>
              <Text color={theme.ok}>↑{room.connectionStats.sendBitrateKbps}k</Text>
              <Text color={theme.info}>↓{room.connectionStats.recvBitrateKbps}k</Text>
              <Text dimColor>|</Text>
              <Text
                color={
                  room.connectionStats.rttMs > 150
                    ? theme.danger
                    : room.connectionStats.rttMs > 80
                      ? theme.warn
                      : theme.text
                }
              >
                RTT:{room.connectionStats.rttMs}ms
              </Text>
              <Text
                color={
                  room.connectionStats.packetLossPercent > 5
                    ? theme.danger
                    : room.connectionStats.packetLossPercent > 1
                      ? theme.warn
                      : theme.text
                }
              >
                Loss:{room.connectionStats.packetLossPercent}%
              </Text>
              <Text dimColor>|</Text>
            </>
          ) : null}
          <Text color={room.connected ? theme.ok : theme.danger}>●</Text>
        </Box>
      </Box>

      {deviceStep === 'loading' && (
        <Box paddingX={1}>
          <Text color={theme.warn}>Loading audio devices...</Text>
        </Box>
      )}

      <SplitPanes
        chat={
          <>
            <ChatLog entries={chat} arrowsScroll={inputFocused} />
            <Rule />
            <ChatInput focused={inputFocused} onSend={room.sendMessage} />
          </>
        }
        people={
          <>
            <ParticipantList
              participants={room.participants}
              username={identity.name}
              color={identity.color}
              isMuted={room.isMuted}
              isVideoMuted={room.isVideoMuted}
              videoEnabled={room.videoEnabled}
              isScreenSharing={room.isScreenSharing}
              remoteMuteStates={room.remoteMuteStates}
              remoteVideoMuteStates={room.remoteVideoMuteStates}
              remoteScreenShareStates={room.remoteScreenShareStates}
              peerVideoOpen={room.peerVideoOpen}
              peerScreenOpen={room.peerScreenOpen}
              speakingStates={room.speakingStates}
              audioLevels={room.audioLevels}
              peerVolumes={room.peerVolumes}
              selectedPeerIdx={selectedPeerIdx}
              connectionStats={room.connectionStats}
            />
            {room.debugMode && (
              <>
                <Rule />
                <DebugLog events={room.roomEvents} />
              </>
            )}
          </>
        }
      />

      {/* Status */}
      <StatusBar
        isMuted={room.isMuted}
        isVideoMuted={room.isVideoMuted}
        videoEnabled={room.videoEnabled}
        webcamEnabled={room.webcamEnabled}
        isScreenSharing={room.isScreenSharing}
        debugMode={room.debugMode}
        peerCam={peerCamAction}
        peerScreen={peerScreenAction}
        inputFocused={inputFocused}
      />

      {/* Error */}
      {room.error && (
        <Box paddingX={1}>
          <Text color={theme.danger}>Error: {room.error}</Text>
        </Box>
      )}
    </Box>
  );
}
