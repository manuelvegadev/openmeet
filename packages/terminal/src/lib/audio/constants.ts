/** Sample rate used end-to-end (capture, WebRTC, playback). */
export const SAMPLE_RATE = 48000;

/** Samples per channel in one 10 ms frame — the unit RTCAudioSource.onData requires. */
export const FRAME_SIZE = 480;

/** Every frame that crosses the backend boundary is interleaved stereo. */
export const CHANNELS = 2;

/** Interleaved samples in one stereo frame. */
export const FRAME_SAMPLES = FRAME_SIZE * CHANNELS;

/** Bytes in one stereo Int16 frame. */
export const FRAME_BYTES = FRAME_SAMPLES * 2;

/** VU meter scale shared by the UI and the engine's level quantization. */
export const VU_BAR_COUNT = 20;
export const VU_MAX_RMS = 8000;
/** RMS above this counts as "speaking" (~2.5% of full scale). */
export const SPEAKING_RMS_THRESHOLD = 800;

export function computeRMS(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** Interleave `frames` mono samples into stereo (L = R), writing at `out[outOffset]`. */
export function upmixMonoToStereo(mono: Int16Array, out: Int16Array, frames = mono.length, outOffset = 0): void {
  for (let i = 0; i < frames; i++) {
    const s = mono[i];
    out[outOffset + i * 2] = s;
    out[outOffset + i * 2 + 1] = s;
  }
}

/** Average `frames` interleaved stereo samples into mono, writing at `out[outOffset]`. */
export function downmixStereoToMono(stereo: Int16Array, out: Int16Array, frames: number, outOffset = 0): void {
  for (let i = 0; i < frames; i++) {
    out[outOffset + i] = (stereo[i * 2] + stereo[i * 2 + 1]) >> 1;
  }
}
