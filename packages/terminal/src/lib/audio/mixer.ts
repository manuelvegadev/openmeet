import { FRAME_SAMPLES, FRAME_SIZE, upmixMonoToStereo } from './constants.js';

/**
 * Per-peer playout buffer: a ring of stereo 10 ms frames fed by RTCAudioSink and drained
 * by the output clock. libwebrtc's NetEQ already smooths network jitter, so this only has
 * to absorb the small cadence mismatch between the decoder and the output device.
 */
export class PeerPlayoutBuffer {
  private readonly ring: Int16Array;
  private readonly capacity: number;
  private readonly prefill: number;
  private readIdx = 0;
  private writeIdx = 0;
  private count = 0;
  private primed = false;
  /** Frames dropped because the ring was full (event-loop stall or clock drift). */
  dropped = 0;
  /** Frames of silence emitted because the ring ran dry. */
  underruns = 0;

  constructor(capacityFrames = 12, prefillFrames = 2) {
    this.capacity = capacityFrames;
    this.prefill = prefillFrames;
    this.ring = new Int16Array(capacityFrames * FRAME_SAMPLES);
  }

  /**
   * Append decoded samples. Accepts mono or stereo; anything that is not a whole number of
   * 480-frame chunks is rejected (RTCAudioSink always delivers 10 ms).
   */
  push(samples: Int16Array, numberOfFrames: number): void {
    const channels = samples.length / numberOfFrames;
    if (channels !== 1 && channels !== 2) return;
    const chunks = numberOfFrames / FRAME_SIZE;
    if (!Number.isInteger(chunks)) return;

    for (let c = 0; c < chunks; c++) {
      if (this.count === this.capacity) {
        // Drop the oldest frame to keep latency bounded.
        this.readIdx = (this.readIdx + 1) % this.capacity;
        this.count--;
        this.dropped++;
      }
      const base = this.writeIdx * FRAME_SAMPLES;
      const srcBase = c * FRAME_SIZE * channels;
      if (channels === 2) {
        this.ring.set(samples.subarray(srcBase, srcBase + FRAME_SAMPLES), base);
      } else {
        upmixMonoToStereo(samples.subarray(srcBase, srcBase + FRAME_SIZE), this.ring, FRAME_SIZE, base);
      }
      this.writeIdx = (this.writeIdx + 1) % this.capacity;
      this.count++;
    }
    if (!this.primed && this.count >= this.prefill) this.primed = true;
  }

  /** Copy the next frame into `out`. Returns false (and leaves `out` untouched) on underrun. */
  pull(out: Int16Array): boolean {
    if (!this.primed || this.count === 0) {
      if (this.primed) {
        this.underruns++;
        this.primed = false; // re-accumulate prefill before resuming
      }
      return false;
    }
    const base = this.readIdx * FRAME_SAMPLES;
    out.set(this.ring.subarray(base, base + FRAME_SAMPLES));
    this.readIdx = (this.readIdx + 1) % this.capacity;
    this.count--;
    return true;
  }
}

/** Sum stereo frames from several peers with per-peer gain into one clamped frame. */
export class FrameMixer {
  private readonly acc = new Int32Array(FRAME_SAMPLES);
  private readonly scratch = new Int16Array(FRAME_SAMPLES);

  mix(out: Int16Array, sources: Iterable<{ buffer: PeerPlayoutBuffer; volume: number }>): void {
    this.acc.fill(0);
    let any = false;
    for (const { buffer, volume } of sources) {
      if (volume <= 0) {
        // Still drain the buffer so a muted peer doesn't build up latency.
        buffer.pull(this.scratch);
        continue;
      }
      if (!buffer.pull(this.scratch)) continue;
      any = true;
      if (volume === 1) {
        for (let i = 0; i < FRAME_SAMPLES; i++) this.acc[i] += this.scratch[i];
      } else {
        for (let i = 0; i < FRAME_SAMPLES; i++) this.acc[i] += Math.round(this.scratch[i] * volume);
      }
    }
    if (!any) {
      out.fill(0);
      return;
    }
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const v = this.acc[i];
      out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
  }
}
