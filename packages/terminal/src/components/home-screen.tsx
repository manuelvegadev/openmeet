import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState } from 'react';

interface HomeScreenProps {
  emoji: string;
  loading: boolean;
  error: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onQuit: () => void;
}

export function HomeScreen({ emoji, loading, error, onCreateRoom, onJoinRoom, onQuit }: HomeScreenProps) {
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
    if (mode === 'menu' && !loading) {
      if (input === 'c') onCreateRoom();
      if (input === 'j') setMode('join');
    }
  });

  if (mode === 'join') {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
        <Text bold color="blue">
          Join Room
        </Text>
        <Box height={1} />
        <Box>
          <Text bold>Room code: </Text>
          <TextInput
            value={joinCode}
            onChange={setJoinCode}
            placeholder="Enter room code"
            onSubmit={(value) => {
              if (value.trim()) onJoinRoom(value.trim());
            }}
          />
        </Box>
        <Box height={1} />
        <Text dimColor>[Enter] join [Esc] back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text bold color="blue">
        {'\u{1F3A5}'} OpenMeet Terminal
      </Text>
      <Text dimColor>Lightweight video conferencing</Text>
      <Box height={1} />
      <Text>
        You are <Text bold>{emoji}</Text>
      </Text>
      <Box height={1} />
      {loading ? (
        <Text color="yellow">Creating room...</Text>
      ) : (
        <>
          <Text>
            [<Text bold>c</Text>] Create Room
          </Text>
          <Text>
            [<Text bold>j</Text>] Join Room
          </Text>
        </>
      )}
      {error && (
        <>
          <Box height={1} />
          <Text color="red">{error}</Text>
        </>
      )}
      <Box height={1} />
      {escPressed ? <Text color="yellow">Press Esc again to quit</Text> : <Text dimColor>[Esc] quit</Text>}
    </Box>
  );
}
