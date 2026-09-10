/**
 * RNNoise noise suppression, as a {@link CaptureProcessor}.
 *
 * RNNoise wants exactly 480 mono samples at 48 kHz in 16-bit PCM scale — which is one of our
 * 10 ms frames, so there is no buffering and no resampling. The Jitsi build embeds the wasm
 * and compiles it synchronously, so there is nothing to await; the `@shiguredo` build is
 * compiled for browsers only and throws "not compiled for this environment" under Node. It
 * is imported by full path because the package entry uses extensionless specifiers that
 * Node's ESM resolver rejects.
 *
 * Each channel gets its own denoiser so a genuinely stereo source keeps its image. When both
 * channels are identical — every mono mic, and anything `InputConditioner` collapsed — only
 * one is processed and the result duplicated, which is the common case and halves the cost.
 */
import { clampInt16, FRAME_SIZE } from './constants.js';
import type { CaptureProcessor } from './processors.js';

export const NOISE_SUPPRESSION_NAME = 'rnnoise';

/** The subset of the emscripten module we use. Declared here so the import can stay lazy. */
interface RnnoiseModule {
  _rnnoise_create(model?: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, out: number, input: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  readonly HEAPF32: Float32Array;
}

/** RNNoise operates on 480 float samples; anything else means we linked the wrong build. */
const RNNOISE_FRAME = 480;

class RnnoiseProcessor implements CaptureProcessor {
  readonly name = NOISE_SUPPRESSION_NAME;
  private disposed = false;

  constructor(
    private readonly wasm: RnnoiseModule,
    private readonly leftState: number,
    private readonly rightState: number,
    private readonly leftPtr: number,
    private readonly rightPtr: number,
  ) {}

  process(samples: Int16Array): Int16Array {
    if (this.disposed) return samples;
    // Re-read the heap view each frame: Emscripten replaces it if the wasm memory grows.
    const heap = this.wasm.HEAPF32;
    const l = this.leftPtr >> 2;
    const r = this.rightPtr >> 2;

    let identical = true;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const left = samples[i * 2];
      const right = samples[i * 2 + 1];
      if (left !== right) identical = false;
      heap[l + i] = left;
      heap[r + i] = right;
    }

    this.wasm._rnnoise_process_frame(this.leftState, this.leftPtr, this.leftPtr);
    if (identical) {
      for (let i = 0; i < FRAME_SIZE; i++) {
        const v = clampInt16(heap[l + i]);
        samples[i * 2] = v;
        samples[i * 2 + 1] = v;
      }
      return samples;
    }

    this.wasm._rnnoise_process_frame(this.rightState, this.rightPtr, this.rightPtr);
    for (let i = 0; i < FRAME_SIZE; i++) {
      samples[i * 2] = clampInt16(heap[l + i]);
      samples[i * 2 + 1] = clampInt16(heap[r + i]);
    }
    return samples;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wasm._rnnoise_destroy(this.leftState);
    this.wasm._rnnoise_destroy(this.rightState);
    this.wasm._free(this.leftPtr);
    this.wasm._free(this.rightPtr);
  }
}

/**
 * Build the processor, or return null when RNNoise cannot be brought up. Noise suppression
 * is a nicety: failing to load it must never keep anyone out of a call.
 *
 * The wasm is imported here rather than at the top of the file: the module is 1.8 MB with the
 * binary embedded, ~10 ms to parse and ~13 MB of RSS, and because the TUI and the engine are
 * the same bundle a static import would pay that twice on every launch — for a setting that
 * is off by default. Same reason `audio/backend.ts` imports its native backends lazily.
 */
export async function createNoiseSuppressor(): Promise<CaptureProcessor | null> {
  if (FRAME_SIZE !== RNNOISE_FRAME) return null;
  try {
    const { default: createRNNWasmModuleSync } = await import('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js');
    const wasm = createRNNWasmModuleSync();
    return new RnnoiseProcessor(
      wasm,
      wasm._rnnoise_create(),
      wasm._rnnoise_create(),
      wasm._malloc(RNNOISE_FRAME * 4),
      wasm._malloc(RNNOISE_FRAME * 4),
    );
  } catch {
    return null;
  }
}
