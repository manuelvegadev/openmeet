/**
 * Capture-side processing hook.
 *
 * Every 10 ms capture frame (interleaved stereo Int16, 480 × 2 samples) flows through the
 * chain before it reaches RTCAudioSource. This is where noise suppression, gain control or
 * echo cancellation plug in without touching the backend or the WebRTC wiring.
 *
 * Contract for implementations:
 * - `process()` is called on the audio cadence (every 10 ms) on the main thread. Keep it
 *   well under 1 ms; allocate buffers up front, never per frame.
 * - Return the frame to forward. Returning `samples` (mutated in place) is fine; returning
 *   another Int16Array of the same length is fine too. The caller copies before handing the
 *   frame to WebRTC, so the returned array may be reused on the next call.
 * - A processor that needs mono (e.g. RNNoise) should downmix, process and upmix itself;
 *   see `downmixStereoToMono` / `upmixMonoToStereo` in constants.ts.
 */
export interface CaptureProcessor {
  readonly name: string;
  process(samples: Int16Array): Int16Array;
  /** Release native/WASM resources. */
  dispose?(): void;
}

export class CaptureProcessorChain {
  private processors: CaptureProcessor[] = [];

  get isEmpty(): boolean {
    return this.processors.length === 0;
  }

  add(processor: CaptureProcessor): void {
    this.processors.push(processor);
  }

  remove(name: string): void {
    const idx = this.processors.findIndex((p) => p.name === name);
    if (idx === -1) return;
    const [removed] = this.processors.splice(idx, 1);
    removed.dispose?.();
  }

  process(samples: Int16Array): Int16Array {
    let frame = samples;
    for (const p of this.processors) {
      frame = p.process(frame);
    }
    return frame;
  }

  dispose(): void {
    for (const p of this.processors) p.dispose?.();
    this.processors = [];
  }
}
