import { theme } from '../lib/theme.js';
import { Text } from './text.js';

/**
 * Footer buttons, two-tone: the key on a gold keycap, what it does on a grey pill right
 * after it — ` m ` + ` mute ` — so a button reads as a keycap on a label rather than as a
 * gold block, and the bar stops competing with the frame. One space separates buttons — flush,
 * a run of disabled ones melts into a single grey bar.
 *
 * Colours come from lib/theme.ts, which explains why none of them are named ANSI colours.
 */
const KEY = { backgroundColor: theme.accent, color: theme.onAccent } as const;
const LABEL = { backgroundColor: theme.surface, color: theme.text } as const;
/** A button that would do nothing right now: both halves go grey, still legible, still in place. */
const OFF = { backgroundColor: theme.surface, color: theme.muted } as const;

export interface KeyHint {
  /** What to press. Two keys for one action are fine: `↑↓`, `-/+`. */
  key: string;
  label: string;
  /**
   * The key is not listened to at the moment — typing in the chat takes every letter, so the
   * room's hotkeys go grey while the input has the focus. Drawn rather than dropped so the
   * bar does not reflow every time the focus moves.
   */
  disabled?: boolean;
}

/** One key on its keycap, for naming a key inside a sentence. */
export function KeyChip({ children }: { children: string }) {
  return <Text {...KEY} bold>{` ${children} `}</Text>;
}

/** A row of footer buttons. */
export function KeyHints({ hints }: { hints: KeyHint[] }) {
  return (
    <Text>
      {hints.map((hint, index) => (
        <Text key={`${hint.key}-${hint.label}`}>
          {index > 0 ? ' ' : ''}
          <Text {...(hint.disabled ? OFF : KEY)} bold>{` ${hint.key} `}</Text>
          <Text {...(hint.disabled ? OFF : LABEL)}>{` ${hint.label} `}</Text>
        </Text>
      ))}
    </Text>
  );
}
