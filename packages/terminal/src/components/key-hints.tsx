import { theme } from '../lib/theme.js';
import { Text } from './text.js';

/**
 * Footer buttons: one background per button covering the key and what it does, with the key
 * in bold — `m mute`, `s share screen`. A single space separates one button from the next.
 *
 * Colours come from lib/theme.ts, which explains why none of them are named ANSI colours.
 */
const CHIP = { backgroundColor: theme.accent, color: theme.onAccent } as const;

export interface KeyHint {
  /** What to press. Two keys for one action are fine: `↑↓`, `-/+`. */
  key: string;
  label: string;
}

/** One key on its chip, for naming a key inside a sentence. */
export function KeyChip({ children }: { children: string }) {
  return (
    <Text {...CHIP} bold>
      {children}
    </Text>
  );
}

/** A row of footer buttons. */
export function KeyHints({ hints }: { hints: KeyHint[] }) {
  return (
    <Text>
      {hints.map((hint, index) => (
        <Text key={`${hint.key}-${hint.label}`}>
          {index > 0 ? ' ' : ''}
          <Text {...CHIP}>
            <Text bold>{hint.key}</Text>
            {` ${hint.label}`}
          </Text>
        </Text>
      ))}
    </Text>
  );
}
