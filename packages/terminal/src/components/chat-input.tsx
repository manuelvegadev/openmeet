import { Box, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { theme } from '../lib/theme.js';
import { type KeyHint, KeyHints } from './key-hints.js';
import { Text } from './text.js';
import { TextInput } from './text-input.js';

interface ChatInputProps {
  focused: boolean;
  /** Off while a modal is up. The draft stays on screen, without the cursor, and takes no keys. */
  active?: boolean;
  onSend: (content: string) => void;
}

/** How long a first Escape stays armed before the draft is safe again. */
const CLEAR_ARM_MS = 2000;

/**
 * The chat's row: the prompt, what you are typing, and the chat's own keys on the right —
 * `tab` to hand the keyboard back and forth, and, once there is a draft, Escape twice to
 * throw it away rather than holding backspace down a long message. Two presses because one
 * would make a stray Escape cost you the message; the same reason the room asks for `q`
 * twice before leaving.
 */
export function ChatInput({ focused, active = true, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [armed, setArmed] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  // Disarm on its own, so an Escape pressed a minute ago cannot clear a later draft.
  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), CLEAR_ARM_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  useInput(
    (_input, key) => {
      if (!key.escape) {
        if (armed) setArmed(false);
        return;
      }
      if (!value) return;
      if (armed) {
        setValue('');
        setArmed(false);
      } else {
        setArmed(true);
      }
    },
    { isActive: active && focused },
  );

  const hints: KeyHint[] = [{ key: 'tab', label: focused ? 'controls' : 'chat' }];
  if (focused && value) hints.push({ key: 'esc esc', label: armed ? 'again to clear' : 'clear' });

  return (
    <Box paddingX={1} justifyContent="space-between" gap={1}>
      <Box>
        <Text bold color={focused ? theme.ok : theme.muted}>
          {'> '}
        </Text>
        {focused ? (
          <TextInput
            focus={active}
            value={value}
            onChange={(next) => {
              setValue(next);
              setArmed(false);
            }}
            onSubmit={(val) => {
              if (val.trim()) {
                onSend(val);
                setValue('');
              }
            }}
            placeholder="Type message..."
          />
        ) : (
          <Text dimColor>Type message...</Text>
        )}
      </Box>
      <KeyHints hints={hints} />
    </Box>
  );
}
