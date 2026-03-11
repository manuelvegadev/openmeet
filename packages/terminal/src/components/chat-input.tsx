import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';

interface ChatInputProps {
  focused: boolean;
  onSend: (content: string) => void;
}

export function ChatInput({ focused, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  return (
    <Box paddingX={1}>
      <Text bold color={focused ? 'green' : 'gray'}>
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
        <Text dimColor>Press [Tab] to type a message</Text>
      )}
    </Box>
  );
}
