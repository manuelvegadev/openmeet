import { VU_BAR_COUNT, VU_MAX_RMS } from '../lib/audio/constants.js';
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

/** Width of the mic meter on the device picker and the room's device step. */
const MIC_BAR_WIDTH = 30;

/** The mic-test meter: one solid bar, no per-peer volume. */
export function MicBar({ level }: { level: number }) {
  const filled = Math.round(Math.min(level / VU_MAX_RMS, 1) * MIC_BAR_WIDTH);
  return <Text color={levelColor(level)}>{'█'.repeat(filled) + '░'.repeat(MIC_BAR_WIDTH - filled)}</Text>;
}

/**
 * The participant meter: the bar is scaled by that peer's volume, so the greyed tail shows
 * how much headroom the volume keys gave away.
 */
export function VuMeter({ level, volume = 1 }: { level: number; volume?: number }) {
  const activeBars = Math.round(volume * VU_BAR_COUNT);
  const filled = Math.round(Math.min(level / VU_MAX_RMS, 1) * activeBars);
  return (
    <Text>
      <Text color={levelColor(level, volume)}>{'█'.repeat(filled)}</Text>
      <Text color={theme.ok}>{'░'.repeat(activeBars - filled)}</Text>
      <Text dimColor>{'░'.repeat(VU_BAR_COUNT - activeBars)}</Text>
    </Text>
  );
}
