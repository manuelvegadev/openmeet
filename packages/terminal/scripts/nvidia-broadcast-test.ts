/**
 * Device-free check of the NVIDIA Broadcast detection:
 * pnpm --filter openmeet-terminal exec tsx scripts/nvidia-broadcast-test.ts
 *
 * The whole feature hangs on matching one device name, and both ways of getting that wrong
 * are quiet. A false negative means paying 0.22 ms a frame to denoise audio the GPU already
 * denoised. A false positive means silently turning noise suppression *off* for someone who
 * asked for it — and the machine this was written on has two NVIDIA audio endpoints that are
 * not Broadcast, so that is not a hypothetical.
 */
import type { AudioDevice } from '../src/lib/audio/backend.js';
import {
  findBroadcastInput,
  hasRtxGpu,
  inputDeviceLabel,
  isBroadcastDevice,
  preferBroadcastFirst,
  resolveBroadcastDefault,
} from '../src/lib/audio/nvidia-broadcast.js';
import { check, finish } from './harness.js';

const input = (name: string, isDefault = false): AudioDevice => ({ id: name, name, type: 'input', isDefault });

// Names taken from the real Windows test box, which has an RTX and two NVIDIA audio
// endpoints — neither of them Broadcast.
const MIC = input('MIC (BRIDGE CAST X V2-I)', true);
const NVIDIA_HDA = input('NVIDIA High Definition Audio');
const NVIDIA_WDM = input('NVIDIA Virtual Audio Device (Wave Extensible) (WDM)');
const BROADCAST = input('Microphone (NVIDIA Broadcast)');
const BROADCAST_ES = input('Micrófono (NVIDIA Broadcast)');
/** The same mic, but set as the Windows default — which is the case worth resolving. */
const BROADCAST_DEFAULT = input('Microphone (NVIDIA Broadcast)', true);
const PLAIN_MIC = input('MIC (BRIDGE CAST X V2-I)');

async function main(): Promise<void> {
  check('the Broadcast mic is recognised', isBroadcastDevice(BROADCAST), true);
  check('...and in a localised Windows, where only the role prefix translates', isBroadcastDevice(BROADCAST_ES), true);
  check('the HDMI audio driver is not it', isBroadcastDevice(NVIDIA_HDA), false);
  check('nor is the virtual audio device', isBroadcastDevice(NVIDIA_WDM), false);
  check('nor is an ordinary microphone', isBroadcastDevice(MIC), false);
  check('an absent selection is not it', isBroadcastDevice(undefined), false);

  const withBroadcast = [MIC, NVIDIA_WDM, BROADCAST, NVIDIA_HDA];
  check('it is found in a list', findBroadcastInput(withBroadcast), BROADCAST);
  check('and absent from one without it', findBroadcastInput([MIC, NVIDIA_HDA]), undefined);

  const ordered = preferBroadcastFirst(withBroadcast);
  check('it is offered first', ordered[0], BROADCAST);
  check('the rest keep the backend order', ordered.slice(1).join('|'), [MIC, NVIDIA_WDM, NVIDIA_HDA].join('|'));
  const untouched = [MIC, NVIDIA_HDA];
  check('a list without it is returned unchanged', preferBroadcastFirst(untouched), untouched);

  check('the label says what it buys you', inputDeviceLabel(BROADCAST).includes('echo cancellation'), true);
  check('an ordinary device is labelled with just its name', inputDeviceLabel(MIC), MIC.name);

  // "System Default" carries no name, so the engine could not otherwise tell what it opened.
  check(
    'a system default that is Broadcast gets named',
    resolveBroadcastDefault(undefined, [PLAIN_MIC, BROADCAST_DEFAULT]),
    BROADCAST_DEFAULT,
  );
  check(
    'Broadcast that is merely installed is left alone',
    resolveBroadcastDefault(undefined, [MIC, BROADCAST]),
    undefined,
  );
  check('an ordinary system default stays the system default', resolveBroadcastDefault(undefined, [MIC]), undefined);
  check('an explicit choice is never second-guessed', resolveBroadcastDefault(MIC, [MIC, BROADCAST_DEFAULT]), MIC);

  // The probe shells out to PowerShell, so off Windows it must answer false without spawning
  // anything. On Windows it answers for the actual GPU — a CI runner has none, a dev box may.
  const rtx = await hasRtxGpu();
  check(
    process.platform === 'win32' ? 'the GPU probe answers on Windows' : 'the GPU probe is a no-op off Windows',
    process.platform === 'win32' ? typeof rtx : rtx,
    process.platform === 'win32' ? 'boolean' : false,
  );

  finish();
}

main();
