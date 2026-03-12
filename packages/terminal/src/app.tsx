import type { Room } from '@openmeet/shared';
import { Box, useApp } from 'ink';
import { useEffect, useState } from 'react';
import { DevicePicker } from './components/device-picker.js';
import { HomeScreen } from './components/home-screen.js';
import { RoomView } from './components/room-view.js';
import {
  type AudioDevice,
  type DeviceEnvs,
  getDeviceEnv,
  getSavedInputDevice,
  getSavedOutputDevice,
  listAudioDevices,
  saveDevicePreferences,
} from './lib/devices.js';

interface AppProps {
  serverUrl: string;
  emoji: string;
  version: string;
  initialRoom?: string;
  inputDevice?: string;
  outputDevice?: string;
  debug?: boolean;
}

type Screen = 'home' | 'devices' | 'room';

function wsToHttpUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '';
  return url.origin;
}

function FullScreen({ children }: { children: React.ReactNode }) {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return (
    <Box
      width={size.columns}
      height={size.rows}
      borderStyle="round"
      borderColor="blue"
      flexDirection="column"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

export function App({ serverUrl, emoji, version, initialRoom, inputDevice, outputDevice, debug = false }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(initialRoom ? 'devices' : 'home');
  const [roomId, setRoomId] = useState(initialRoom ?? '');
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({
    inputs: [],
    outputs: [],
  });
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deviceEnvs, setDeviceEnvs] = useState<DeviceEnvs>({ recExtra: {}, playExtra: {} });
  const [creating, setCreating] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [savedInputId] = useState(() => getSavedInputDevice());
  const [savedOutputId] = useState(() => getSavedOutputDevice());

  // Load audio devices
  useEffect(() => {
    listAudioDevices().then((d) => {
      setDevices(d);
      setDevicesLoaded(true);
    });
  }, []);

  // Skip device picker if CLI flags or saved preferences match available devices
  useEffect(() => {
    if (screen !== 'devices' || !devicesLoaded) return;

    // CLI flags take priority
    if (inputDevice && outputDevice) {
      const input = devices.inputs.find((d) => d.name === inputDevice);
      const output = devices.outputs.find((d) => d.name === outputDevice);
      setDeviceEnvs(getDeviceEnv(input, output));
      setScreen('room');
      return;
    }

    // Saved preferences — skip picker if both are still valid (or were system default)
    if (savedInputId !== null || savedOutputId !== null) {
      const inputStillExists = !savedInputId || devices.inputs.some((d) => d.id === savedInputId);
      const outputStillExists = !savedOutputId || devices.outputs.some((d) => d.id === savedOutputId);
      if (inputStillExists && outputStillExists) {
        const input = savedInputId ? devices.inputs.find((d) => d.id === savedInputId) : undefined;
        const output = savedOutputId ? devices.outputs.find((d) => d.id === savedOutputId) : undefined;
        setDeviceEnvs(getDeviceEnv(input, output));
        setScreen('room');
      }
    }
  }, [screen, inputDevice, outputDevice, devices, devicesLoaded, savedInputId, savedOutputId]);

  const handleCreateRoom = async () => {
    setCreating(true);
    setHomeError(null);
    try {
      const httpUrl = wsToHttpUrl(serverUrl);
      const res = await fetch(`${httpUrl}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Room' }),
      });
      if (res.ok) {
        const room: Room = await res.json();
        setRoomId(room.id);
        setScreen('devices');
      } else {
        setHomeError('Failed to create room');
      }
    } catch {
      setHomeError('Cannot reach server');
    } finally {
      setCreating(false);
    }
  };

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
          loading={creating}
          error={homeError}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuit={() => exit()}
        />
      )}
      {screen === 'devices' && (
        <DevicePicker
          inputs={devices.inputs}
          outputs={devices.outputs}
          loading={!devicesLoaded}
          savedInputId={savedInputId}
          savedOutputId={savedOutputId}
          onConfirm={(input, output) => {
            saveDevicePreferences(input, output);
            setDeviceEnvs(getDeviceEnv(input, output));
            setScreen('room');
          }}
        />
      )}
      {screen === 'room' && (
        <RoomView
          serverUrl={serverUrl}
          roomId={roomId}
          username={emoji}
          version={version}
          deviceEnvs={deviceEnvs}
          debug={debug}
          onBack={() => setScreen('home')}
        />
      )}
    </FullScreen>
  );
}
