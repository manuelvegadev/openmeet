import { Box, useApp, useWindowSize } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import { DevicePicker } from './components/device-picker.js';
import { HomeScreen } from './components/home-screen.js';
import { ProfileSetup } from './components/profile-setup.js';
import { RoomView } from './components/room-view.js';
import { SettingsView } from './components/settings-view.js';
import { type AudioDevice, type AudioDeviceSelection, listAudioDevices } from './engine/client.js';
import { resolveBroadcastDefault } from './lib/audio/nvidia-broadcast.js';
import type { Identity } from './lib/identity.js';
import { loadIdentity, loadSettings, saveSettings } from './lib/settings.js';
import { framedBorder, theme } from './lib/theme.js';

interface AppProps {
  serverUrl: string;
  version: string;
  initialRoom?: string;
  inputDevice?: string;
  outputDevice?: string;
  videoEnabled?: boolean;
  /** Shown in the room log when `videoEnabled` is false, so the missing buttons explain themselves. */
  videoDisabledReason?: string;
  webcamEnabled?: boolean;
  videoDevice?: string;
  debug?: boolean;
}

/** `profile` comes first, once: nothing else makes sense without a name to join as. */
type Screen = 'profile' | 'home' | 'settings' | 'devices' | 'room';

/**
 * The window frame, sized to the terminal.
 *
 * Only the height is tracked: Ink already lays the root out to the terminal width, so a Box
 * with no `width` stretches to it, while a Box is only as tall as its content and the frame
 * has to reach the bottom for the painted background to cover. Never pass a `width` derived
 * from our own resize handling — see gotcha 30e for what that cost.
 *
 * `closeBottom` is how the room draws its own last line: a screen whose bottom edge carries a
 * junction (the chat/participants divider meets it) has to draw that edge itself, because a
 * child cannot bleed downwards onto the border the way `Rule` bleeds sideways onto it — the
 * clip below is the whole point. Everything else lets the frame close itself.
 *
 * Clipping is vertical only. Ink clips an `overflow="hidden"` box at its border, and the
 * section rules need to reach *over* the border to draw their `├` and `┤` on it (see `Rule`);
 * nothing else is ever wider than the frame, while content taller than the terminal must not
 * scroll the alternate screen.
 */
function FullScreen({ children, closeBottom = true }: { children: React.ReactNode; closeBottom?: boolean }) {
  const { rows } = useWindowSize();

  return (
    <Box
      height={rows}
      borderStyle="round"
      borderBottom={closeBottom}
      backgroundColor={theme.bg}
      {...framedBorder}
      flexDirection="column"
      overflowY="hidden"
    >
      {children}
    </Box>
  );
}

export function App({
  serverUrl,
  version,
  initialRoom,
  inputDevice,
  outputDevice,
  videoEnabled,
  videoDisabledReason,
  webcamEnabled,
  videoDevice,
  debug = false,
}: AppProps) {
  const { exit } = useApp();
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const afterProfile: Screen = initialRoom ? 'devices' : 'home';
  const [screen, setScreen] = useState<Screen>(identity ? afterProfile : 'profile');
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
    <FullScreen closeBottom={screen !== 'room'}>
      {screen === 'profile' && (
        <ProfileSetup
          onDone={(next) => {
            saveSettings({ name: next.name, color: next.color });
            setIdentity(next);
            setScreen(afterProfile);
          }}
        />
      )}
      {screen === 'home' && identity && (
        <HomeScreen
          identity={identity}
          version={version}
          onJoinRoom={handleJoinRoom}
          onSettings={() => setScreen('settings')}
          onQuit={() => exit()}
        />
      )}
      {screen === 'settings' && (
        <SettingsView
          onBack={() => {
            setIdentity(loadIdentity());
            setScreen('home');
          }}
        />
      )}
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
      {screen === 'room' && identity && (
        <RoomView
          serverUrl={serverUrl}
          roomId={roomId}
          identity={identity}
          version={version}
          deviceSelection={deviceSelection}
          videoEnabled={videoEnabled}
          videoDisabledReason={videoDisabledReason}
          webcamEnabled={webcamEnabled}
          videoDevice={videoDevice}
          debug={debug}
          onBack={() => setScreen('home')}
        />
      )}
    </FullScreen>
  );
}
