/**
 * Audio backend smoke test — no server, no WebRTC.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/audio-smoke.ts [rtaudio|sox] [seconds]
 *
 * Lists devices, opens the default input/output, counts capture frames and plays a 440 Hz
 * tone for half a second. Use it to validate a machine's audio stack before joining a room.
 */
import { createAudioBackend } from '../src/lib/audio/backend.js';
import { computeRMS } from '../src/lib/audio/constants.js';
import { ToneGenerator } from '../src/lib/audio/tone.js';

const name = (process.argv[2] as 'sox' | 'rtaudio' | undefined) ?? 'rtaudio';
const seconds = Number(process.argv[3] ?? 2);

const backend = await createAudioBackend(name);
const devs = await backend.listDevices();
console.log(
  `[${name}] inputs :`,
  devs.inputs.map((d) => `${d.name}${d.isDefault ? ' *' : ''}`),
);
console.log(
  `[${name}] outputs:`,
  devs.outputs.map((d) => `${d.name}${d.isDefault ? ' *' : ''}`),
);

let frames = 0;
let maxRms = 0;
let playbackFrames = 0;
const tone = new ToneGenerator({ hz: 440, seconds: 0.5, gain: 0.2 });
const t0 = Date.now();

await backend.start(
  {},
  {
    onCapture: (s) => {
      frames++;
      maxRms = Math.max(maxRms, computeRMS(s));
    },
    onPlayback: (out) => {
      playbackFrames++;
      tone.fill(out);
    },
    onError: (m) => console.log('ERROR:', m),
    onDebug: (m) => console.log('debug:', m),
  },
);

await new Promise((r) => setTimeout(r, seconds * 1000));
backend.stop();
const ms = Date.now() - t0;
console.log(
  `[${name}] ${frames} capture frames in ${ms} ms (expected ~${Math.round(ms / 10)}), ${playbackFrames} playback frames, peak mic RMS ${Math.round(maxRms)}`,
);
// audify keeps its thread-safe callbacks registered until the object is collected, which
// would keep the event loop alive; the app exits explicitly for the same reason.
process.exit(0);
