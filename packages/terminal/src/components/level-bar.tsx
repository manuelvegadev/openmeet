import { VU_BAR_COUNT, VU_MAX_RMS, VU_SUBSTEPS } from '../lib/audio/constants.js';
import { theme } from '../lib/theme.js';
import { Text } from './text.js';

/**
 * Audio level → colour. The one place the meter's thresholds live: green up to 40%, amber to
 * 75%, red above. Deliberately not the accent colour — a meter that turns the same yellow as
 * the interface chrome stops reading as a meter.
 */
export function levelColor(level: number, volume = 1): string {
  const normalized = Math.min(level / VU_MAX_RMS, 1) * volume;
  if (normalized > 0.75) return theme.danger;
  if (normalized > 0.4) return theme.warn;
  return theme.ok;
}

/**
 * The left-aligned partial blocks, by eighths: index 1 is one eighth filled, 8 is a full
 * cell. Drawn in the level colour over the track colour, so a partial cell is the same two
 * colours as the full cells before it and the empty ones after — the boundary just moves in
 * eighths of a cell instead of whole cells.
 */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

/**
 * A bar `width` cells wide filled to `fraction` (0..1) in `color`, on the track colour. The
 * fill is rounded to eighths of a cell, so a ten-cell bar has eighty steps.
 */
function Bar({ fraction, width, color }: { fraction: number; width: number; color: string }) {
  const units = Math.round(Math.max(0, Math.min(fraction, 1)) * width * VU_SUBSTEPS);
  const full = Math.floor(units / VU_SUBSTEPS);
  const part = units % VU_SUBSTEPS;
  const empty = width - full - (part ? 1 : 0);
  return (
    <Text color={color} backgroundColor={theme.surface}>
      {'█'.repeat(full)}
      {EIGHTHS[part]}
      {' '.repeat(Math.max(0, empty))}
    </Text>
  );
}

/** Width of the mic meter on the device picker and the room's device step. */
const MIC_BAR_WIDTH = 30;

/** The mic-test meter: one solid bar, no per-peer volume. */
export function MicBar({ level }: { level: number }) {
  return <Bar fraction={level / VU_MAX_RMS} width={MIC_BAR_WIDTH} color={levelColor(level)} />;
}

/**
 * The participant meter: the track is as long as that peer's volume allows, so the bare tail
 * after it shows how much headroom the volume keys gave away.
 */
export function VuMeter({ level, volume = 1 }: { level: number; volume?: number }) {
  const active = Math.round(volume * VU_BAR_COUNT);
  return (
    <Text>
      <Bar fraction={level / VU_MAX_RMS} width={active} color={levelColor(level, volume)} />
      {' '.repeat(VU_BAR_COUNT - active)}
    </Text>
  );
}
