import { Box } from 'ink';
import SelectInput from 'ink-select-input';
import type { ComponentProps } from 'react';
import { Pointer, Text } from './text.js';

/**
 * `ink-select-input` with the theme applied.
 *
 * The stock component draws its pointer and the highlighted label in `color="blue"` — a
 * palette index, so a different hue in every terminal — and the other labels with no
 * foreground at all, which is the terminal's default: black on a light theme, over the
 * dark panel the app paints (gotcha 30b). It accepts replacements for both pieces, so this
 * is the only file that imports it; `biome.json` refuses the import anywhere else.
 *
 * The marker is `POINTER` in the accent, the same the settings menu draws for its own rows,
 * and the label goes bold rather than changing colour, so a picker and the settings screen
 * highlight the same way.
 */
export function Select<V>(props: Omit<ComponentProps<typeof SelectInput<V>>, 'indicatorComponent' | 'itemComponent'>) {
  return <SelectInput {...props} indicatorComponent={Indicator} itemComponent={Item} />;
}

function Indicator({ isSelected = false }: { isSelected?: boolean }) {
  return (
    <Box marginRight={1}>
      <Pointer on={isSelected} />
    </Box>
  );
}

function Item({ isSelected = false, label }: { isSelected?: boolean; label: string }) {
  return <Text bold={isSelected}>{label}</Text>;
}
