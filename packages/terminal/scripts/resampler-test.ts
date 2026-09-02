/**
 * Resampler quality check: a 1 kHz tone (plus a 7 kHz one) through common device ↔ 48 kHz
 * ratios, fed in irregular chunks like a driver would. Prints frequency error, SNR against
 * a fitted sine (≥ 80 dB is transparent for 16-bit audio) and throughput.
 *
 *   pnpm --filter openmeet-terminal exec tsx scripts/resampler-test.ts
 */
import { Resampler } from '../src/lib/audio/resampler.js';

/** Least-squares fit of the given tones; returns signal/residual in dB plus the 1st tone's frequency. */
function fitTones(y: Float64Array, rate: number, tones: number[]): { snrDb: number; measuredHz: number } {
  const fit = new Float64Array(y.length);
  for (const hz of tones) {
    let ss = 0;
    let sc = 0;
    let cc = 0;
    let ys = 0;
    let yc = 0;
    for (let n = 0; n < y.length; n++) {
      const s = Math.sin((2 * Math.PI * hz * n) / rate);
      const c = Math.cos((2 * Math.PI * hz * n) / rate);
      ss += s * s;
      sc += s * c;
      cc += c * c;
      ys += (y[n] - fit[n]) * s;
      yc += (y[n] - fit[n]) * c;
    }
    const det = ss * cc - sc * sc;
    const a = (ys * cc - yc * sc) / det;
    const b = (yc * ss - ys * sc) / det;
    for (let n = 0; n < y.length; n++)
      fit[n] += a * Math.sin((2 * Math.PI * hz * n) / rate) + b * Math.cos((2 * Math.PI * hz * n) / rate);
  }
  let sig = 0;
  let res = 0;
  for (let n = 0; n < y.length; n++) {
    sig += fit[n] * fit[n];
    res += (y[n] - fit[n]) * (y[n] - fit[n]);
  }
  // Frequency of the dominant tone via zero crossings of the fit
  let zc = 0;
  for (let n = 1; n < fit.length; n++) if (fit[n - 1] < 0 && fit[n] >= 0) zc++;
  return { snrDb: 10 * Math.log10(sig / Math.max(res, 1e-9)), measuredHz: (zc * rate) / fit.length };
}

const cases: Array<[number, number]> = [
  [44100, 48000],
  [48000, 44100],
  [96000, 48000],
  [48000, 96000],
  [16000, 48000],
  [48000, 16000],
  [22050, 48000],
  [192000, 48000],
];

for (const [inRate, outRate] of cases) {
  const r = new Resampler(inRate, outRate, 2);
  const seconds = 2;
  const total = inRate * seconds;
  const hz = 1000;
  const hz2 = Math.min(7000, Math.min(inRate, outRate) / 2 - 1000); // stays below both Nyquists
  // Left channel only, written straight from each output chunk.
  const y = new Float64Array(outRate * seconds + 4096);
  let produced = 0;
  let pos = 0;
  const t0 = performance.now();
  // Irregular chunk sizes, like a driver period that is not a multiple of 10 ms.
  const sizes = [441, 480, 512, 1024, 37, 960, 100];
  let si = 0;
  while (pos < total) {
    const n = Math.min(sizes[si++ % sizes.length], total - pos);
    const chunk = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      const v = Math.round(
        (0.5 * Math.sin((2 * Math.PI * hz * (pos + i)) / inRate) +
          0.25 * Math.sin((2 * Math.PI * hz2 * (pos + i)) / inRate)) *
          32767,
      );
      chunk[i * 2] = v;
      chunk[i * 2 + 1] = v;
    }
    pos += n;
    const out = r.process(chunk);
    for (let i = 0; i < out.length; i += 2) y[produced++] = out[i];
  }
  const ms = performance.now() - t0;
  // Skip the filter's warm-up.
  const skip = Math.min(2000, produced >> 3);
  const seg = y.subarray(skip, produced);
  const { snrDb, measuredHz } = fitTones(seg, outRate, [hz, hz2]);
  const expected = outRate * seconds;
  console.log(
    `${String(inRate).padStart(6)} → ${String(outRate).padEnd(6)}  out ${produced}/${expected} frames  f=${measuredHz.toFixed(1)} Hz  ` +
      `SNR ${snrDb.toFixed(0)} dB (1 kHz + ${hz2} Hz tones)  ${(ms / seconds).toFixed(1)} ms per second of audio`,
  );
}
