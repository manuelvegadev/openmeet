import { Box } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';
import { theme } from '../lib/theme.js';
import { KeyChip } from './key-hints.js';
import { Text } from './text.js';

interface ChatInputProps {
  focused: boolean;
  onSend: (content: string) => void;
}

export function ChatInput({ focused, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  return (
    <Box paddingX={1}>
      <Text bold color={focused ? theme.ok : theme.muted}>
        {'> '}
      </Text>
      {focused ? (
        <TextInput
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
        <Text>
          {/* The chip stays out of the dim wrapper so it keeps its full contrast. */}
          <Text dimColor>Press </Text>
          <KeyChip>tab</KeyChip>
          <Text dimColor> to type a message</Text>
        </Text>
      )}
    </Box>
  );
}
