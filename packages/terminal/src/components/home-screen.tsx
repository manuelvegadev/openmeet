import { Box, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { Identity } from '../lib/identity.js';
import { getPlatformSupport } from '../lib/platform.js';
import { theme } from '../lib/theme.js';
import type { UpdateStatus } from '../lib/update.js';
import { KeyHints } from './key-hints.js';
import { Name } from './name.js';
import { Text } from './text.js';
import { TextInput } from './text-input.js';

interface HomeScreenProps {
  identity: Identity;
  version: string;
  /** A newer version, once it is downloaded and installable (see lib/update.ts). */
  update?: UpdateStatus | null;
  /** This launch is the first on a version installed behind the user's back. */
  justUpdated?: boolean;
  onJoinRoom: (roomId: string) => void;
  onSettings: () => void;
  /** `r`: quit, install, come back. */
  onRestartUpdate: () => void;
  onQuit: () => void;
}

/** How long the green tick stays after a silent update, before the version goes quiet again. */
const UPDATED_TICK_MS = 4000;

const support = getPlatformSupport();

export function HomeScreen({
  identity,
  version,
  update,
  justUpdated = false,
  onJoinRoom,
  onSettings,
  onRestartUpdate,
  onQuit,
}: HomeScreenProps) {
  const [mode, setMode] = useState<'menu' | 'join'>('menu');
  const [joinCode, setJoinCode] = useState('');
  const [escPressed, setEscPressed] = useState(false);
  const [showTick, setShowTick] = useState(justUpdated);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The tick is an answer to a question nobody asked, so it says its piece and goes.
  useEffect(() => {
    if (!showTick) return;
    const timer = setTimeout(() => setShowTick(false), UPDATED_TICK_MS);
    return () => clearTimeout(timer);
  }, [showTick]);

  // Clear the "press again" hint after 2 seconds
  useEffect(() => {
    if (escPressed) {
      escTimerRef.current = setTimeout(() => setEscPressed(false), 2000);
      return () => {
        if (escTimerRef.current) clearTimeout(escTimerRef.current);
      };
    }
  }, [escPressed]);

  useInput((input, key) => {
    if (mode === 'join' && key.escape) {
      setMode('menu');
      setJoinCode('');
      return;
    }
    if (mode === 'menu' && key.escape) {
      if (escPressed) {
        onQuit();
      } else {
        setEscPressed(true);
      }
      return;
    }
    if (mode === 'menu') {
      if (input === 'j') setMode('join');
      if (input === 's') onSettings();
      if (input === 'r' && update?.ready) onRestartUpdate();
    }
  });

  if (mode === 'join') {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Text bold color={theme.accent}>
          Join Room
        </Text>
        <Box height={1} />
        <Box>
          <Text bold>Room: </Text>
          <TextInput
            value={joinCode}
            onChange={setJoinCode}
            placeholder="name a room"
            onSubmit={(value) => {
              if (value.trim()) onJoinRoom(value.trim());
            }}
          />
        </Box>
        <Box height={1} />
        <KeyHints
          hints={[
            { key: 'enter', label: 'join' },
            { key: 'esc', label: 'back' },
          ]}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text bold color={theme.accent}>
        {'\u{1F3A5}'} OpenMeet Terminal <Text dimColor>v{version}</Text>
        {update && <Text color={theme.accent}> → v{update.version}</Text>}
        {showTick && <Text color={theme.ok}> ✓ updated</Text>}{' '}
        <Text dimColor>
          · {support.name}: {support.features}
        </Text>
      </Text>
      <Text dimColor>Lightweight video conferencing</Text>
      <Box height={1} />
      <Text>
        You are <Name name={identity.name} color={identity.color} bold />
      </Text>
      <Box height={1} />
      <KeyHints hints={[{ key: 'j', label: 'join room' }]} />
      <KeyHints hints={[{ key: 's', label: 'settings' }]} />
      {update && (
        <>
          <Box height={1} />
          {update.ready ? (
            <>
              <Text dimColor>Update downloaded. Restart to install.</Text>
              <KeyHints hints={[{ key: 'r', label: 'restart now' }]} />
            </>
          ) : (
            <Text dimColor>
              v{update.version} is out. Install it with: <Text color={theme.text}>{update.command}</Text>
            </Text>
          )}
        </>
      )}
      <Box height={1} />
      {escPressed ? (
        <Text color={theme.warn}>Press Esc again to quit</Text>
      ) : (
        <KeyHints hints={[{ key: 'esc', label: 'quit' }]} />
      )}
    </Box>
  );
}
