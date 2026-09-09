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
export const VU_BAR_COUNT = 10;
/** Steps per cell: the meter draws eighth-blocks, so a level moves in eighths of a cell. */
export const VU_SUBSTEPS = 8;
/** Distinct levels the meter can show; the engine quantizes to these before sending. */
export const VU_LEVEL_STEPS = VU_BAR_COUNT * VU_SUBSTEPS;

/**
 * Meter ballistics: fast attack, slow release. The shown level jumps to any louder frame at
 * once and otherwise falls at this rate — a pop rises to its peak and then takes a moment to
 * come down, instead of flashing for one frame. 20 dB/s is in the range broadcast peak
 * meters use (the BBC PPM falls 20 dB in 1.7 s).
 */
export const VU_RELEASE_DB_PER_S = 20;
/** The per-frame multiplier that release rate works out to, for one 10 ms frame. */
export const VU_RELEASE_PER_FRAME = 10 ** (-(VU_RELEASE_DB_PER_S / 100) / 20);

/** One step of the meter's ballistics: the new level is the frame's RMS if louder, else the old one released a frame. */
export function followLevel(shown: number, rms: number): number {
  return Math.max(rms, shown * VU_RELEASE_PER_FRAME);
}
export const VU_MAX_RMS = 8000;
/** RMS above this counts as "speaking" (~2.5% of full scale). */
export const SPEAKING_RMS_THRESHOLD = 800;

/** Frames in one 10 ms period at `rate`. */
export function framesPer10ms(rate: number): number {
  return rate / 100;
}

/** Saturate to the Int16 range (typed-array stores would wrap instead). */
export function clampInt16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v);
}

/** Sum of squares per channel of an interleaved stereo frame (no sqrt: cheap to compare). */
export function channelEnergy(samples: Int16Array): [number, number] {
  let l = 0;
  let r = 0;
  for (let i = 0; i < samples.length; i += 2) {
    l += samples[i] * samples[i];
    r += samples[i + 1] * samples[i + 1];
  }
  return [l, r];
}

/** RMS per channel of an interleaved stereo frame. */
export function computeChannelRMS(samples: Int16Array): [number, number] {
  const [l, r] = channelEnergy(samples);
  const n = samples.length >> 1;
  return [Math.sqrt(l / n), Math.sqrt(r / n)];
}

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
