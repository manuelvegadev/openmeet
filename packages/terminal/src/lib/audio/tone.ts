import { SAMPLE_RATE } from './constants.js';

export interface ToneOptions {
  /** Frequency in Hz. */
  hz: number;
  /** Total duration in seconds; silence after that. */
  seconds: number;
  /** Linear fade in/out length in seconds (0 for none). */
  fadeSeconds?: number;
  /** Peak amplitude, 0..1. */
  gain?: number;
}

/**
 * Fills stereo 10 ms frames with a sine tone followed by silence. Used by the device
 * picker's test tone and the audio smoke test — the frame contract is the backend's
 * (480 frames, interleaved stereo Int16).
 */
export class ToneGenerator {
  private pos = 0;
  private readonly totalFrames: number;
  private readonly fadeFrames: number;
  private readonly step: number;
  private readonly gain: number;

  constructor(options: ToneOptions) {
    this.totalFrames = Math.round(options.seconds * SAMPLE_RATE);
    this.fadeFrames = Math.round((options.fadeSeconds ?? 0) * SAMPLE_RATE);
    this.step = (2 * Math.PI * options.hz) / SAMPLE_RATE;
    this.gain = options.gain ?? 0.3;
  }

  /** True once the tone (not the trailing silence) has been fully produced. */
  get done(): boolean {
    return this.pos >= this.totalFrames;
  }

  /** Fills `out` (interleaved stereo, any frame count) with the next samples. */
  fill(out: Int16Array): void {
    const frames = out.length >> 1;
    for (let i = 0; i < frames; i++) {
      let gain = 0;
      if (this.pos < this.totalFrames) {
        gain = this.gain;
        if (this.fadeFrames > 0) {
          if (this.pos < this.fadeFrames) gain *= this.pos / this.fadeFrames;
          else if (this.pos > this.totalFrames - this.fadeFrames)
            gain *= (this.totalFrames - this.pos) / this.fadeFrames;
        }
      }
      const s = Math.round(Math.sin(this.pos * this.step) * gain * 32767);
      out[i * 2] = s;
      out[i * 2 + 1] = s;
      this.pos++;
    }
  }
}
