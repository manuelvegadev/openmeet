import { useEffect, useState } from 'react';
import type { AudioDevice } from '../engine/client.js';
import {
  BROADCAST_DOWNLOAD,
  findBroadcastInput,
  hasRtxGpu,
  inputDeviceLabel,
  preferBroadcastFirst,
} from '../lib/audio/nvidia-broadcast.js';
import { theme } from '../lib/theme.js';
import { Text } from './text.js';

/** The value the pickers use for "no preference"; `onSelect` maps it back to `undefined`. */
export const SYSTEM_DEFAULT_ITEM = { label: 'System Default', value: '__default__' };

/** The input list both pickers show: the system default, then the Broadcast mic, then the rest. */
export function inputPickerItems(inputs: AudioDevice[]): { label: string; value: string }[] {
  return [
    SYSTEM_DEFAULT_ITEM,
    ...preferBroadcastFirst(inputs).map((d) => ({ label: inputDeviceLabel(d), value: d.id })),
  ];
}

/**
 * Whether to suggest installing Broadcast: an RTX is present and no Broadcast mic is. The
 * PowerShell probe only runs when the device list has loaded and holds no Broadcast entry —
 * on a machine that has it, the device is the proof and the probe is never spawned.
 */
function useSuggestBroadcast(inputs: AudioDevice[], loaded: boolean): boolean {
  const [suggest, setSuggest] = useState(false);
  const installed = findBroadcastInput(inputs) !== undefined;
  useEffect(() => {
    if (!loaded || installed) return;
    hasRtxGpu().then(setSuggest);
  }, [loaded, installed]);
  return suggest && !installed;
}

/** One line telling an RTX owner what Broadcast would add. Renders nothing otherwise. */
export function BroadcastHint({ inputs, loaded = true }: { inputs: AudioDevice[]; loaded?: boolean }) {
  const suggest = useSuggestBroadcast(inputs, loaded);
  if (!suggest) return null;
  return (
    <Text color={theme.info}>
      This machine has an RTX: NVIDIA Broadcast adds noise removal and echo cancellation on the GPU, and shows up here
      as another microphone — {BROADCAST_DOWNLOAD}
    </Text>
  );
}
