/**
 * `@jitsi/rnnoise-wasm` ships no types, and its package entry (`index.js`) re-exports with
 * extensionless specifiers that Node's ESM resolver rejects — `ERR_MODULE_NOT_FOUND` at
 * runtime, even though bundlers and tsx resolve it fine. So the sync build is imported by
 * its full path instead; it embeds the wasm, so there is nothing to fetch.
 */
declare module '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js' {
  interface RNWasmModule {
    _rnnoise_create(model?: number): number;
    _rnnoise_destroy(state: number): void;
    /** Denoises 480 float samples in 16-bit PCM scale; returns the voice-activity estimate. */
    _rnnoise_process_frame(state: number, out: number, input: number): number;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    readonly HEAPF32: Float32Array;
  }
  const createRNNWasmModuleSync: () => RNWasmModule;
  export default createRNNWasmModuleSync;
}
