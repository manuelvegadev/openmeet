/**
 * NVIDIA Broadcast: noise removal and echo cancellation, on the GPU.
 *
 * Broadcast installs a virtual microphone that enumerates as an ordinary WASAPI endpoint, so
 * nothing has to be wired for it to *work* — it already shows up in the device picker like
 * any other device. What this module adds is knowing *which* entry it is, so:
 *
 * - the picker can say what it does, and offer it first;
 * - the engine can skip RNNoise when it is the source, because the GPU has already done that
 *   work and 0.22 ms a frame is 0.22 ms off the audio loop;
 * - a machine with an RTX but without Broadcast can be told it is leaving that on the table.
 *
 * It also brings the one thing we have no answer for anywhere else: echo cancellation. We
 * push PCM through `RTCAudioSource.onData`, which bypasses libwebrtc's audio processing
 * module entirely, and Windows' own driver AEC would need `AudioCategory_Communications`,
 * which RtAudio does not set. Broadcast sidesteps both by cleaning the signal before it ever
 * reaches an audio API we control.
 *
 * Windows only, and deliberately not abstracted: Broadcast has no macOS build, and the macOS
 * equivalent (Voice Isolation) is a system-wide toggle with no device of its own to detect.
 */
import { platform } from 'node:os';
import { runPowerShell } from '../powershell.js';
import type { AudioDevice } from './backend.js';

/** What the picker and the settings screen call it. */
export const BROADCAST_LABEL = 'GPU noise removal + echo cancellation';

export const BROADCAST_DOWNLOAD = 'https://www.nvidia.com/broadcast-app';

/**
 * Windows localises an endpoint's role prefix — "Microphone (…)", "Micrófono (…)" — but the
 * device name inside the parentheses comes from the driver and does not translate. Matching
 * the driver name is therefore locale-proof, where matching "Microphone" would not be.
 */
const BROADCAST_NAME = /nvidia broadcast/i;

/**
 * Broadcast refuses to install on anything below an RTX 20-series, so an endpoint carrying
 * its name is *also* proof of the GPU. That makes the happy path free: no probe, no
 * PowerShell, just the device list we already enumerate.
 */
export function isBroadcastDevice(device: AudioDevice | undefined): boolean {
  return device !== undefined && BROADCAST_NAME.test(device.name);
}

export function findBroadcastInput(inputs: AudioDevice[]): AudioDevice | undefined {
  return inputs.find(isBroadcastDevice);
}

/**
 * The Broadcast mic first, then everything else in the order the backend gave us.
 *
 * Only the devices are reordered — "System Default" keeps its place at the top of the lists
 * that offer it, because demoting it would change what every non-RTX machine lands on.
 */
export function preferBroadcastFirst(inputs: AudioDevice[]): AudioDevice[] {
  const broadcast = findBroadcastInput(inputs);
  if (!broadcast) return inputs;
  return [broadcast, ...inputs.filter((d) => d !== broadcast)];
}

/** How a device reads in a picker: the Broadcast mic says what it does for you. */
export function inputDeviceLabel(device: AudioDevice): string {
  return isBroadcastDevice(device) ? `${device.name} — ${BROADCAST_LABEL}` : device.name;
}

/**
 * Name the input the engine will actually open, when the system default happens to be the
 * Broadcast mic.
 *
 * `undefined` in a selection means "system default", which carries no name — so a user who
 * set Broadcast as their Windows default and never opened the picker would look, to
 * everything downstream, exactly like someone on a plain microphone, and would pay for
 * RNNoise on top of work the GPU had already done. Naming it opens the very same endpoint;
 * the only thing given up is following a *later* change of the Windows default, which we do
 * not follow anyway (there are no default-change notifications — gotcha 21e).
 */
export function resolveBroadcastDefault(
  selected: AudioDevice | undefined,
  inputs: AudioDevice[],
): AudioDevice | undefined {
  if (selected) return selected;
  const systemDefault = inputs.find((d) => d.isDefault);
  return isBroadcastDevice(systemDefault) ? systemDefault : undefined;
}

/**
 * Whether this machine has an RTX GPU — only ever asked to decide whether to *suggest*
 * Broadcast to someone who has not installed it.
 *
 * GTX and older cards do not match, on purpose: suggesting an app that will refuse to
 * install is worse than saying nothing. PowerShell costs ~1 s to start, so the probe runs
 * once per process, is cached, and lives in the TUI process where nothing has a deadline —
 * never in the engine, which is next to live audio (gotcha 25).
 */
const RTX_NAME = /\bRTX\b/i;
const GPU_SCRIPT = 'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }';

let rtxProbe: Promise<boolean> | null = null;

export function hasRtxGpu(): Promise<boolean> {
  if (platform() !== 'win32') return Promise.resolve(false);
  rtxProbe ??= runPowerShell(GPU_SCRIPT).then((out) => out != null && RTX_NAME.test(out));
  return rtxProbe;
}
