/**
 * Streaming polyphase sample-rate converter for interleaved Int16 audio.
 *
 * Devices run at whatever rate they like (44.1 kHz USB mixers, 96 kHz interfaces, 16 kHz
 * Bluetooth headsets); the pipeline is always 48 kHz. Converting in-process means neither
 * the driver's resampler (audibly poor on WASAPI capture) nor CoreAudio's nominal device
 * rate (which RtAudio would otherwise change under the user) is involved.
 *
 * Design: rational ratio L/M, windowed-sinc (Kaiser) prototype low-pass designed at the
 * L× upsampled rate, evaluated as L polyphase branches. Output sample n sits at input
 * position n·M/L; the branch index is the fractional part. Stateful across calls, so any
 * input chunking works and output arrives as soon as enough input is buffered.
 */

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Zeroth-order modified Bessel function, for the Kaiser window. */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const y = (x / 2) * (x / 2);
  for (let k = 1; k < 50; k++) {
    term *= y / (k * k);
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

import { clampInt16 } from './constants.js';

export class Resampler {
  private readonly channels: number;
  private readonly L: number;
  private readonly M: number;
  /** Taps per polyphase branch. */
  private readonly T: number;
  /** Prototype filter, length T·L, already scaled by L. */
  private readonly h: Float32Array;
  /** Input history + pending input, interleaved (Int16 is exact in the double MACs). */
  private buf: Int16Array;
  private bufLen = 0;
  /** Index (in frames) of the next output's base input frame, relative to buf. */
  private pos = 0;
  private phase = 0;
  private out = new Int16Array(0);

  constructor(inRate: number, outRate: number, channels = 2) {
    if (inRate <= 0 || outRate <= 0) throw new Error('Resampler: invalid rate');
    this.channels = channels;
    const g = gcd(inRate, outRate);
    this.L = outRate / g;
    this.M = inRate / g;

    // Enough taps that decimation still has a steep anti-alias filter: ~32 taps per output
    // sample at the input rate, more when decimating.
    this.T = Math.ceil(32 * Math.max(1, this.M / this.L));
    const N = this.T * this.L;
    const cutoff = (Math.min(inRate, outRate) / 2) * 0.92; // Hz, leave a guard band
    const fs = inRate * this.L; // rate of the upsampled signal the prototype runs at
    const fc = cutoff / fs; // cycles per sample
    const beta = 8.6; // Kaiser: ~-90 dB stop-band
    const denom = besselI0(beta);
    const mid = (N - 1) / 2;
    const h = new Float32Array(N);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const t = i - mid;
      const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      const r = (2 * i) / (N - 1) - 1;
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / denom;
      h[i] = sinc * w;
      sum += h[i];
    }
    // Unity DC gain per branch: the sum over all taps is the DC gain of the L× filter.
    const scale = this.L / sum;
    for (let i = 0; i < N; i++) h[i] *= scale;
    this.h = h;
    // History of T frames plus room for a generous input chunk.
    this.buf = new Int16Array((this.T + Math.ceil(inRate / 10)) * channels);
    this.pos = this.T - 1;
  }

  /** Convert `input` (interleaved, any frame count) and return every output sample now available. */
  process(input: Int16Array): Int16Array {
    const ch = this.channels;

    if (this.bufLen + input.length > this.buf.length) {
      const grown = new Int16Array((this.bufLen + input.length) * 2);
      grown.set(this.buf.subarray(0, this.bufLen));
      this.buf = grown;
    }
    this.buf.set(input, this.bufLen);
    this.bufLen += input.length;

    const bufFrames = this.bufLen / ch;
    // Upper bound on outputs: each consumes M/L input frames.
    const maxOut = Math.ceil(((bufFrames - this.pos) * this.L) / this.M) + 1;
    if (this.out.length < maxOut * ch) this.out = new Int16Array(maxOut * ch);
    let n = 0;
    const h = this.h;
    const L = this.L;
    const M = this.M;
    const T = this.T;
    const buf = this.buf;
    const out = this.out;
    while (this.pos < bufFrames) {
      const base = this.pos * ch;
      const p = this.phase;
      for (let c = 0; c < ch; c++) {
        let acc = 0;
        let idx = base + c;
        let k = p;
        for (let t = 0; t < T; t++) {
          acc += h[k] * buf[idx];
          k += L;
          idx -= ch;
        }
        out[n * ch + c] = clampInt16(acc);
      }
      n++;
      const step = this.phase + M;
      this.pos += Math.floor(step / L);
      this.phase = step % L;
    }
    // Keep only the history the next output still needs.
    const keepFrom = this.pos - (T - 1);
    if (keepFrom > 0) {
      this.buf.copyWithin(0, keepFrom * ch, this.bufLen);
      this.bufLen -= keepFrom * ch;
      this.pos -= keepFrom;
    }

    return this.out.subarray(0, n * ch);
  }
}
