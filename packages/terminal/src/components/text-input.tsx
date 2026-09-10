import { useInput } from 'ink';
import { useEffect, useState } from 'react';
import { visibility } from '../lib/window-state.js';
import { Text } from './text.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Shown in the muted grey while `value` is empty. */
  placeholder?: string;
  /** Whether keys reach this input. The cursor is only drawn while they do. */
  focus?: boolean;
}

/** Cursor blink half-period. 530 ms is what most terminals and editors use. */
const BLINK_MS = 530;
/**
 * Blinks before the cursor settles solid, as editors do after a few idle seconds. Each toggle
 * is a full Ink frame, so an idle room would otherwise write two frames a second forever.
 */
const BLINK_TOGGLES = 10;

/**
 * A single-line text input, themed and with a blinking cursor.
 *
 * It replaces `ink-text-input`, which drew what you typed with no foreground (the terminal's
 * default, black on a light theme), its placeholder through `chalk.grey` (palette entry 8),
 * and a cursor that could not blink: its only cursor switch also turns off arrow-key editing.
 * The terminal's own cursor is not an option either — Ink hides it, and placing it would mean
 * knowing the input's screen position after every layout.
 *
 * So the blink is ours: a state toggled every `BLINK_MS` while focused, which costs one Ink
 * render per toggle in the TUI process — the engine never sees it (gotcha 25). Every edit
 * restarts the phase with the cursor showing, as a real cursor does; after `BLINK_TOGGLES`
 * idle toggles it stays on, so an idle input costs nothing; and while the window is hidden
 * (`lib/window-state.ts`) the timer stops with the cursor on, so a paused TUI stays paused.
 */
export function TextInput({ value, onChange, onSubmit, placeholder, focus = true }: Props) {
  const [cursor, setCursor] = useState(value.length);
  // Cursor phase: `true` = drawn.
  const [shown, setShown] = useState(true);

  // Keyed on the text and the cursor: every edit restarts the timer with the cursor showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` and `cursor` are the restart trigger
  useEffect(() => {
    if (!focus) return;
    setShown(true);
    let timer: NodeJS.Timeout | null = null;
    let toggles = 0;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      setShown(true);
    };
    const run = (hidden: boolean) => {
      stop();
      if (hidden) return;
      timer = setInterval(() => {
        if (++toggles > BLINK_TOGGLES) stop();
        else setShown((s) => !s);
      }, BLINK_MS);
    };
    run(visibility.hidden);
    visibility.on('change', run);
    return () => {
      visibility.off('change', run);
      if (timer) clearInterval(timer);
    };
  }, [focus, value, cursor]);

  // The value can change from outside (cleared after a send): keep the cursor inside it.
  const at = Math.min(cursor, value.length);

  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow || key.tab || (key.ctrl && input === 'c')) return;
      if (key.return) {
        onSubmit?.(value);
        return;
      }
      if (key.leftArrow) {
        setCursor(Math.max(0, at - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor(Math.min(value.length, at + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (at === 0) return;
        onChange(value.slice(0, at - 1) + value.slice(at));
        setCursor(at - 1);
        return;
      }
      if (!input) return;
      onChange(value.slice(0, at) + input + value.slice(at));
      setCursor(at + input.length);
    },
    { isActive: focus },
  );

  if (!focus) {
    return value.length > 0 ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>;
  }

  // The cell under the cursor: the character there, or a space past the end.
  const under = at < value.length ? value[at] : ' ';
  return (
    <Text>
      {value.slice(0, at)}
      <Text inverse={shown}>{under}</Text>
      {value.slice(at + 1)}
      {value.length === 0 && placeholder ? <Text dimColor>{placeholder}</Text> : null}
    </Text>
  );
}
