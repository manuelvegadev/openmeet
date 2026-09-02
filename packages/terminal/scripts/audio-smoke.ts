/**
 * Audio backend smoke test — no server, no WebRTC.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/audio-smoke.ts [rtaudio|sox] [seconds] [dump.s16le] [gain]
 *
 * With a dump path, the captured frames are written as raw s16le stereo (at the capture
 * rate printed below) and the tone plays for the whole run — loop the output into an input
 * (e.g. a mixer's "SUB MIX" bus) to inspect the capture path offline.
 *
 * Lists devices, opens the default input/output, counts capture frames and plays a 440 Hz
 * tone for half a second. Use it to validate a machine's audio stack before joining a room.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { createAudioBackend } from '../src/lib/audio/backend.js';
import { computeRMS } from '../src/lib/audio/constants.js';
import { ToneGenerator } from '../src/lib/audio/tone.js';

const name = (process.argv[2] as 'sox' | 'rtaudio' | undefined) ?? 'rtaudio';
const seconds = Number(process.argv[3] ?? 2);
const dumpPath = process.argv[4];
if (dumpPath) writeFileSync(dumpPath, '');

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
const gain = Number(process.argv[5] ?? 0.2);
const tone = new ToneGenerator({ hz: 440, seconds: dumpPath ? seconds + 1 : 0.5, gain });
let captureRate = 0;
// OPENMEET_SMOKE_TIMING=1: histogram of intervals between capture / playback callbacks.
const timing = process.env.OPENMEET_SMOKE_TIMING === '1';
const inGaps: number[] = [];
const outGaps: number[] = [];
let lastIn = 0;
let lastOut = 0;
const t0 = Date.now();

// OPENMEET_SMOKE_INPUT / OPENMEET_SMOKE_OUTPUT pick devices by name (default: system default).
const pick = (list: typeof devs.inputs, name: string | undefined) =>
  name ? list.find((d) => d.name === name) : undefined;
const selection = {
  input: pick(devs.inputs, process.env.OPENMEET_SMOKE_INPUT),
  output: pick(devs.outputs, process.env.OPENMEET_SMOKE_OUTPUT),
};
await backend.start(selection, {
  onCapture: (s, rate) => {
    frames++;
    if (timing) {
      const now = performance.now();
      if (lastIn) inGaps.push(now - lastIn);
      lastIn = now;
    }
    captureRate = rate;
    maxRms = Math.max(maxRms, computeRMS(s));
    if (dumpPath) appendFileSync(dumpPath, Buffer.from(s.buffer, s.byteOffset, s.byteLength));
  },
  onPlayback: (out) => {
    playbackFrames++;
    if (timing) {
      const now = performance.now();
      if (lastOut) outGaps.push(now - lastOut);
      lastOut = now;
    }
    tone.fill(out);
  },
  onError: (m) => console.log('ERROR:', m),
  onDebug: (m) => console.log('debug:', m),
});

await new Promise((r) => setTimeout(r, seconds * 1000));
backend.stop();
const ms = Date.now() - t0;
if (timing) {
  const hist = (gaps: number[]) => {
    const h = new Map<number, number>();
    for (const g of gaps) {
      const b = g < 1 ? 0 : Math.min(Math.round(g), 100);
      h.set(b, (h.get(b) ?? 0) + 1);
    }
    return [...h.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, n]) => `${ms}ms:${n}`)
      .join(' ');
  };
  console.log(`[${name}] capture callback intervals: ${hist(inGaps)}`);
  console.log(`[${name}] playback callback intervals: ${hist(outGaps)}`);
}
if (dumpPath) console.log(`[${name}] capture dump: ${dumpPath} (s16le, stereo, ${captureRate} Hz)`);
console.log(
  `[${name}] ${frames} capture frames in ${ms} ms (expected ~${Math.round(ms / 10)}), ${playbackFrames} playback frames, peak mic RMS ${Math.round(maxRms)}`,
);
// audify keeps its thread-safe callbacks registered until the object is collected, which
// would keep the event loop alive; the app exits explicitly for the same reason.
process.exit(0);
