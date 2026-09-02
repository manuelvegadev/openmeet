/** Synthetic check of the input channel policy: pnpm --filter openmeet-terminal exec tsx scripts/channels-test.ts */
import { type InputChannelPolicy, InputConditioner } from '../src/lib/audio/channels.js';
import { computeChannelRMS, FRAME_SIZE } from '../src/lib/audio/constants.js';

function frames(ampL: number, ampR: number, count: number): Int16Array[] {
  const out: Int16Array[] = [];
  let pos = 0;
  for (let f = 0; f < count; f++) {
    const fr = new Int16Array(FRAME_SIZE * 2);
    for (let i = 0; i < FRAME_SIZE; i++) {
      const s = Math.sin((pos++ * 2 * Math.PI * 300) / 48000);
      fr[i * 2] = Math.round(s * ampL);
      fr[i * 2 + 1] = Math.round(s * ampR * 0.7); // different amplitude so L!=R in stereo cases
    }
    out.push(fr);
  }
  return out;
}

function run(label: string, policy: InputChannelPolicy, ampL: number, ampR: number, gainDb = 0) {
  const c = new InputConditioner(policy, gainDb);
  let decision = '';
  c.onDecision = (p, d) => {
    decision = `${p} (${d})`;
  };
  const silence = frames(0, 0, 50); // leading silence must not count
  for (const f of silence) c.process(f);
  const speech = frames(ampL, ampR, 150);
  for (const f of speech) c.process(f);
  const [rmsL, rmsR] = computeChannelRMS(speech[speech.length - 1]);
  console.log(
    `${label.padEnd(34)} policy=${policy.padEnd(6)} → ${c.current}  out L ${rmsL.toFixed(0)} R ${rmsR.toFixed(0)}  ${decision}`,
  );
}

run('mic on input 1 only (L loud, R silent)', 'auto', 8000, 0);
run('mic on input 2 only', 'auto', 0, 8000);
run('true stereo source', 'auto', 8000, 8000);
run('quiet mono mic in L (still > floor)', 'auto', 400, 0);
run('below signal floor: stays undecided', 'auto', 100, 0);
run('forced mono', 'mono', 8000, 0);
run('forced right', 'right', 8000, 2000);
run('+12 dB gain on quiet mic', 'auto', 400, 0, 12);
run('gain clamps instead of wrapping', 'stereo', 30000, 30000, 12);
