/**
 * Device compatibility matrix — opens every input and output device the active backend can
 * see and reports what happened. Use it on a new machine or after touching the backends.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/audio-matrix.ts [rtaudio|sox] [seconds-per-device]
 *
 * For each input: the stream the backend opened (native rate/channels), frames delivered
 * per second (should be ~100), per-channel RMS and imbalance (spots a mono mic in a stereo
 * pair) and any driver error. For each output: whether a short tone plays without error.
 */
import {
  type AudioDeviceSelection,
  type AudioStreamCallbacks,
  createAudioBackend,
  getActiveBackendName,
} from '../src/lib/audio/backend.js';
import { imbalanceDb } from '../src/lib/audio/channels.js';
import { computeChannelRMS } from '../src/lib/audio/constants.js';
import { ToneGenerator } from '../src/lib/audio/tone.js';

const name = (process.argv[2] as 'sox' | 'rtaudio' | undefined) ?? getActiveBackendName();
const seconds = Number(process.argv[3] ?? 2);

const backend = await createAudioBackend(name);
const devs = await backend.listDevices();
console.log(`[${name}] ${devs.inputs.length} inputs, ${devs.outputs.length} outputs\n`);

/** Open a stream for `ms`, collecting driver errors and the backend's stream description. */
async function probe(
  selection: AudioDeviceSelection,
  cbs: Pick<AudioStreamCallbacks, 'onCapture' | 'onPlayback'>,
  ms: number,
): Promise<{ error: string; info: string }> {
  let error = '';
  let info = '';
  try {
    await backend.start(selection, {
      ...cbs,
      onError: (m) => {
        error += `${m}; `;
      },
      onDebug: (m) => {
        if (m.startsWith('Audio')) info = m.replace(/^Audio \([^)]*\): /, '');
      },
    });
    await new Promise((r) => setTimeout(r, ms));
  } catch (err) {
    error += err instanceof Error ? err.message : String(err);
  }
  backend.stop();
  return { error, info };
}

const line = (status: string, label: string, info: string, extra = '') =>
  console.log(
    `  ${status.padEnd(8)} ${label}\n           ${info || '(no stream info)'}${extra ? `\n           ${extra}` : ''}`,
  );

console.log('INPUTS');
for (const input of devs.inputs) {
  let frames = 0;
  let sumL = 0;
  let sumR = 0;
  const t0 = Date.now();
  const { error, info } = await probe(
    { input },
    {
      onCapture: (s) => {
        frames++;
        const [l, r] = computeChannelRMS(s);
        sumL += l;
        sumR += r;
      },
      onPlayback: (out) => out.fill(0),
    },
    seconds * 1000,
  );
  const fps = frames / ((Date.now() - t0) / 1000);
  const l = frames ? Math.round(sumL / frames) : 0;
  const r = frames ? Math.round(sumR / frames) : 0;
  const status = error ? `ERROR ${error}` : fps > 80 ? 'ok' : `LOW RATE ${fps.toFixed(0)}/s`;
  line(
    status,
    `${input.name}${input.isDefault ? ' *' : ''}`,
    info,
    `${fps.toFixed(0)} frames/s, rms L ${l} R ${r} (${imbalanceDb(l, r).toFixed(0)} dB apart)`,
  );
}

console.log('\nOUTPUTS');
for (const output of devs.outputs) {
  let played = 0;
  const tone = new ToneGenerator({ hz: 660, seconds: 0.6, fadeSeconds: 0.03, gain: 0.15 });
  const { error, info } = await probe(
    { output },
    {
      onCapture: () => {},
      onPlayback: (out) => {
        played++;
        tone.fill(out);
      },
    },
    1000,
  );
  const status = error ? `ERROR ${error}` : played > 50 ? 'ok' : `LOW RATE ${played}/s`;
  line(status, `${output.name}${output.isDefault ? ' *' : ''}`, info);
}

process.exit(0);
