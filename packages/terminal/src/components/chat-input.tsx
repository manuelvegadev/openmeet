import { Box } from 'ink';
import { useState } from 'react';
import { theme } from '../lib/theme.js';
import { Text } from './text.js';
import { TextInput } from './text-input.js';

interface ChatInputProps {
  focused: boolean;
  /** Off while a modal is up. The draft stays on screen, without the cursor, and takes no keys. */
  active?: boolean;
  onSend: (content: string) => void;
}

export function ChatInput({ focused, active = true, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  return (
    <Box paddingX={1}>
      <Text bold color={focused ? theme.ok : theme.muted}>
        {'> '}
      </Text>
      {focused ? (
        <TextInput
          focus={active}
          value={value}
          onChange={setValue}
          onSubmit={(val) => {
            if (val.trim()) {
              onSend(val);
              setValue('');
            }
          }}
          placeholder="Type message..."
        />
      ) : (
        // Plain grey: the bar below already shows `tab` as a live button, a second chip here was noise.
        <Text dimColor>Press tab to type a message</Text>
      )}
    </Box>
  );
}
