import { Box, useApp, useWindowSize } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import { DevicePicker } from './components/device-picker.js';
import { HomeScreen } from './components/home-screen.js';
import { RoomView } from './components/room-view.js';
import { SettingsView } from './components/settings-view.js';
import { type AudioDevice, type AudioDeviceSelection, listAudioDevices } from './engine/client.js';
import { resolveBroadcastDefault } from './lib/audio/nvidia-broadcast.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { framedBorder, theme } from './lib/theme.js';

interface AppProps {
  serverUrl: string;
  emoji: string;
  version: string;
  initialRoom?: string;
  inputDevice?: string;
  outputDevice?: string;
  videoEnabled?: boolean;
  webcamEnabled?: boolean;
  videoDevice?: string;
  debug?: boolean;
}

type Screen = 'home' | 'settings' | 'devices' | 'room';

/**
 * The window frame, sized to the terminal.
 *
 * Only the height is tracked: Ink already lays the root out to the terminal width, so a Box
 * with no `width` stretches to it, while a Box is only as tall as its content and the frame
 * has to reach the bottom for the painted background to cover. Never pass a `width` derived
 * from our own resize handling — see gotcha 30e for what that cost.
 */
function FullScreen({ children }: { children: React.ReactNode }) {
  const { rows } = useWindowSize();

  return (
    <Box
      height={rows}
      borderStyle="round"
      backgroundColor={theme.bg}
      {...framedBorder}
      flexDirection="column"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

export function App({
  serverUrl,
  emoji,
  version,
  initialRoom,
  inputDevice,
  outputDevice,
  videoEnabled,
  webcamEnabled,
  videoDevice,
  debug = false,
}: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(initialRoom ? 'devices' : 'home');
  const [roomId, setRoomId] = useState(initialRoom ?? '');
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({
    inputs: [],
    outputs: [],
  });
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deviceSelection, setDeviceSelection] = useState<AudioDeviceSelection>({});

  // Load audio devices
  useEffect(() => {
    listAudioDevices().then((d) => {
      setDevices(d);
      setDevicesLoaded(true);
    });
  }, []);

  /**
   * The one way into the room. The saved ids stay exactly what was chosen ("System Default"
   * included); only the live selection is resolved, so the engine can see when the system
   * default is really the Broadcast mic.
   */
  const enterRoom = useCallback(
    (input: AudioDevice | undefined, output: AudioDevice | undefined) => {
      setDeviceSelection({ input: resolveBroadcastDefault(input, devices.inputs), output });
      setScreen('room');
    },
    [devices.inputs],
  );

  // Resolve device selection from saved settings when transitioning to devices screen
  useEffect(() => {
    if (screen !== 'devices' || !devicesLoaded) return;

    const settings = loadSettings();

    // CLI flags take priority
    if (inputDevice && outputDevice) {
      const input = devices.inputs.find((d) => d.name === inputDevice);
      const output = devices.outputs.find((d) => d.name === outputDevice);
      enterRoom(input, output);
      return;
    }

    // Saved preferences — skip picker if user configured before and devices still exist
    if (settings.devicesConfigured) {
      const inputStillExists = !settings.audioInputId || devices.inputs.some((d) => d.id === settings.audioInputId);
      const outputStillExists = !settings.audioOutputId || devices.outputs.some((d) => d.id === settings.audioOutputId);
      if (inputStillExists && outputStillExists) {
        const input = settings.audioInputId ? devices.inputs.find((d) => d.id === settings.audioInputId) : undefined;
        const output = settings.audioOutputId
          ? devices.outputs.find((d) => d.id === settings.audioOutputId)
          : undefined;
        enterRoom(input, output);
      }
    }
  }, [screen, inputDevice, outputDevice, devices, devicesLoaded, enterRoom]);

  const handleJoinRoom = (id: string) => {
    setRoomId(id);
    setScreen('devices');
  };

  return (
    <FullScreen>
      {screen === 'home' && (
        <HomeScreen
          emoji={emoji}
          version={version}
          onJoinRoom={handleJoinRoom}
          onSettings={() => setScreen('settings')}
          onQuit={() => exit()}
        />
      )}
      {screen === 'settings' && <SettingsView onBack={() => setScreen('home')} />}
      {screen === 'devices' && (
        <DevicePicker
          inputs={devices.inputs}
          outputs={devices.outputs}
          loading={!devicesLoaded}
          savedInputId={loadSettings().audioInputId}
          savedOutputId={loadSettings().audioOutputId}
          onConfirm={(input, output) => {
            saveSettings({
              audioInputId: input?.id ?? null,
              audioOutputId: output?.id ?? null,
              devicesConfigured: true,
            });
            enterRoom(input, output);
          }}
        />
      )}
      {screen === 'room' && (
        <RoomView
          serverUrl={serverUrl}
          roomId={roomId}
          username={emoji}
          version={version}
          deviceSelection={deviceSelection}
          videoEnabled={videoEnabled}
          webcamEnabled={webcamEnabled}
          videoDevice={videoDevice}
          debug={debug}
          onBack={() => setScreen('home')}
        />
      )}
    </FullScreen>
  );
}
