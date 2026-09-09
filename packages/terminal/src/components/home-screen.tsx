import { Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState } from 'react';
import { getPlatformSupport } from '../lib/platform.js';
import { theme } from '../lib/theme.js';
import { KeyHints } from './key-hints.js';
import { Text } from './text.js';

interface HomeScreenProps {
  emoji: string;
  version: string;
  onJoinRoom: (roomId: string) => void;
  onSettings: () => void;
  onQuit: () => void;
}

const support = getPlatformSupport();

export function HomeScreen({ emoji, version, onJoinRoom, onSettings, onQuit }: HomeScreenProps) {
  const [mode, setMode] = useState<'menu' | 'join'>('menu');
  const [joinCode, setJoinCode] = useState('');
  const [escPressed, setEscPressed] = useState(false);
  const escTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        {'\u{1F3A5}'} OpenMeet Terminal <Text dimColor>v{version}</Text>{' '}
        <Text dimColor>
          · {support.name}: {support.features}
        </Text>
      </Text>
      <Text dimColor>Lightweight video conferencing</Text>
      <Box height={1} />
      <Text>
        You are <Text bold>{emoji}</Text>
      </Text>
      <Box height={1} />
      <KeyHints hints={[{ key: 'j', label: 'join room' }]} />
      <KeyHints hints={[{ key: 's', label: 'settings' }]} />
      <Box height={1} />
      {escPressed ? (
        <Text color={theme.warn}>Press Esc again to quit</Text>
      ) : (
        <KeyHints hints={[{ key: 'esc', label: 'quit' }]} />
      )}
    </Box>
  );
}
