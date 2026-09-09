import { Box, useInput } from 'ink';
import { useState } from 'react';
import { NAME_PALETTE } from '../lib/identity.js';
import { Name } from './name.js';
import { Pointer, Text } from './text.js';

interface ColorPickerProps {
  /** The name to preview each colour on. */
  name: string;
  /** The current colour, highlighted first. */
  value?: string | null;
  onSelect: (hex: string) => void;
}

/**
 * The palette a name can be drawn in, one row per colour with the name previewed in it —
 * you pick what you will look like, not a colour swatch. ↑/↓ move, Enter picks; the caller
 * owns Escape.
 */
export function ColorPicker({ name, value, onSelect }: ColorPickerProps) {
  const start = Math.max(
    0,
    NAME_PALETTE.findIndex((c) => c.hex === value),
  );
  const [index, setIndex] = useState(start);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(NAME_PALETTE.length - 1, i + 1));
    else if (key.return) onSelect(NAME_PALETTE[index].hex);
  });

  return (
    <Box flexDirection="column">
      {NAME_PALETTE.map((c, i) => (
        <Box key={c.hex} gap={1}>
          <Pointer on={i === index} />
          <Name name={name} color={c.hex} bold={i === index} />
          <Text dimColor>{c.name}</Text>
        </Box>
      ))}
    </Box>
  );
}
