import { Box, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { theme } from '../lib/theme.js';
import { KeyHints } from './key-hints.js';
import { Rule, Text } from './text.js';
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
 * The chat's composer: its rule, and under it the prompt, what you are typing, and `tab` to
 * hand the keyboard back and forth.
 *
 * Escape twice throws the draft away — better than holding backspace down a long message —
 * and two presses because one stray Escape should not cost you what you wrote. The offer only
 * appears once you have pressed it: a chip sitting in the row permanently would take a fifth
 * of the width to advertise a key you rarely want, so the first press writes it on the line
 * above the rule instead. That line is always there, empty when nothing is armed, so the
 * conversation does not jump when it comes and goes.
 *
 * The rule belongs to this component because that line is where the notice goes; the room
 * just places the composer under the conversation.
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

  return (
    <>
      {/* The row is always here, empty until armed: appearing and disappearing would push the
          conversation up and down under the reader. */}
      <Box height={1} flexShrink={0} paddingX={1} justifyContent="flex-end">
        {armed ? <Text dimColor>esc again to clear</Text> : null}
      </Box>
      <Rule />
      <Box paddingX={1}>
        {/* Never shrinks: squeezed to one column, the prompt loses the space after it and the
            message starts against the `>`. */}
        <Box flexShrink={0}>
          <Text bold color={focused ? theme.ok : theme.muted}>
            {'> '}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
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
            // Unfocused, the draft stays on screen — it is still there when you come back.
            <Text dimColor>{value || 'Type message...'}</Text>
          )}
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <KeyHints hints={[{ key: 'tab', label: focused ? 'controls' : 'chat' }]} />
        </Box>
      </Box>
    </>
  );
}
