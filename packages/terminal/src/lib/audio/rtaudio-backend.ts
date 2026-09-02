import { platform } from 'node:os';
import type { AudioBackend, AudioDevice, AudioDeviceSelection, AudioStreamCallbacks } from './backend.js';
import {
  CHANNELS,
  downmixStereoToMono,
  FRAME_SAMPLES,
  FRAME_SIZE,
  SAMPLE_RATE,
  upmixMonoToStereo,
} from './constants.js';

// audify (RtAudio) types — imported lazily so machines using sox never load the native addon.
type AudifyModule = typeof import('audify');
type RtAudioInstance = InstanceType<AudifyModule['RtAudio']>;
type RtDeviceInfo = ReturnType<RtAudioInstance['getDevices']>[number];

// audify declares its enums as `const enum`, which TypeScript refuses to reference as
// values from another module, so spell out the two we use.
type RtFormat = Parameters<RtAudioInstance['openStream']>[2];
type RtFlags = Parameters<RtAudioInstance['openStream']>[8];
const FORMAT_SINT16 = 0x2 as RtFormat;
// No RTAUDIO_MINIMIZE_LATENCY: on CoreAudio it forces the device's minimum period
// (15 frames on common hardware), which would mean ~3000 callbacks per second.
const STREAM_FLAGS = 0 as RtFlags;

/** Output audio kept queued in the driver: enough to ride out a TUI render, not enough to hear. */
const TARGET_QUEUE_MS = 20;
const MAX_QUEUE_MS = 50;

/**
 * RtAudio 6 error types (vendored in audify): 0 = NO_ERROR, 1 = WARNING, 2+ = real errors.
 * audify's exported `RtAudioErrorType` object still carries RtAudio 5's numbering, so it
 * cannot be used for this check.
 */
const RT_FIRST_REAL_ERROR = 2;

let audifyPromise: Promise<AudifyModule> | null = null;

/**
 * One long-lived instance for enumeration and probing. audify's destructor calls
 * closeStream() unconditionally and its error callback is shared across instances, so
 * every throwaway RtAudio object would surface a "no open stream to close" warning when
 * it is garbage-collected.
 */
let probeInstance: RtAudioInstance | null = null;

function getProbe(audify: AudifyModule): RtAudioInstance {
  if (!probeInstance) probeInstance = new audify.RtAudio(pickApi(audify));
  return probeInstance;
}

async function loadAudify(): Promise<AudifyModule> {
  if (!audifyPromise) {
    audifyPromise = import('audify')
      .then((mod) => {
        // audify is CommonJS; under ESM its exports live on `default`.
        const resolved = (mod as unknown as { default?: AudifyModule }).default ?? mod;
        if (typeof resolved.RtAudio !== 'function') throw new Error('RtAudio export not found');
        return resolved;
      })
      .catch((err) => {
        audifyPromise = null;
        throw new Error(`The native audio module (audify) failed to load: ${err instanceof Error ? err.message : err}`);
      });
  }
  return audifyPromise;
}

function pickApi(audify: AudifyModule): number | undefined {
  // Declared as a const enum in audify's typings, but present at runtime.
  const api = (audify as unknown as { RtAudioApi: Record<string, number> }).RtAudioApi;
  switch (platform()) {
    case 'win32':
      return api.WINDOWS_WASAPI;
    case 'darwin':
      return api.MACOSX_CORE;
    case 'linux':
      return api.LINUX_PULSE;
    default:
      return undefined;
  }
}

interface ResolvedDevice {
  info: RtDeviceInfo;
  channels: number;
}

/**
 * The rate to open the capture stream at: the device's preferred (shared-mode) rate when
 * it is not 48 kHz and can be cut into 10 ms frames, else 48 kHz.
 */
function nativeCaptureRate(info: RtDeviceInfo): number {
  const rate = info.preferredSampleRate;
  if (!rate || rate === SAMPLE_RATE || rate % 100 !== 0) return SAMPLE_RATE;
  if (info.sampleRates.length > 0 && !info.sampleRates.includes(rate)) return SAMPLE_RATE;
  return rate;
}

/**
 * Native backend on top of audify (RtAudio): WASAPI on Windows, CoreAudio on macOS.
 * One duplex stream when the driver allows it, otherwise separate input/output streams.
 * Frames are re-chunked to 480 samples regardless of the driver's period.
 */
export class RtAudioBackend implements AudioBackend {
  readonly name = 'rtaudio' as const;
  private duplex: RtAudioInstance | null = null;
  private input: RtAudioInstance | null = null;
  private output: RtAudioInstance | null = null;
  private callbacks: AudioStreamCallbacks | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  // Capture re-chunking (driver period → 10 ms stereo frames at the capture rate)
  private inChannels = CHANNELS;
  private inRate = SAMPLE_RATE;
  private inFrames = FRAME_SIZE;
  private inAccum = new Int16Array(0);
  private inAccumLen = 0;
  private captureFrame = new Int16Array(FRAME_SAMPLES);

  // Playback re-chunking (480-frame stereo frames → driver period)
  private outChannels = CHANNELS;
  private outPeriod = FRAME_SIZE;
  private outAccum = new Int16Array(0);
  private outAccumLen = 0;
  private readonly playbackFrame = new Int16Array(FRAME_SAMPLES);
  private queuedPeriods = 0;
  private targetPeriods = 2;
  private maxPeriods = 5;

  // Diagnostics: gaps between input callbacks reveal event-loop stalls (TUI renders,
  // GC) that the audio path has to absorb.
  private lastInputAt = 0;
  private stallCount = 0;
  private stallMaxMs = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  async listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
    const audify = await loadAudify();
    const rt = getProbe(audify);
    const inputs: AudioDevice[] = [];
    const outputs: AudioDevice[] = [];
    for (const { info, id } of this.enumerate(rt)) {
      if (info.inputChannels > 0) inputs.push({ id, name: info.name, type: 'input', isDefault: !!info.isDefaultInput });
      if (info.outputChannels > 0)
        outputs.push({ id, name: info.name, type: 'output', isDefault: !!info.isDefaultOutput });
    }
    return { inputs, outputs };
  }

  async start(selection: AudioDeviceSelection, callbacks: AudioStreamCallbacks): Promise<void> {
    this.stop();
    const audify = await loadAudify();
    this.callbacks = callbacks;

    const probe = getProbe(audify);
    const devices = this.enumerate(probe); // one native sweep for both lookups
    const inDev = this.resolve(probe, devices, selection.input, 'input');
    const outDev = this.resolve(probe, devices, selection.output, 'output');
    if (!inDev && !outDev) throw new Error('No audio devices found');

    this.inChannels = inDev?.channels ?? CHANNELS;
    this.outChannels = outDev?.channels ?? CHANNELS;
    // Capture at the device's native shared-mode rate when it is not 48 kHz: RtAudio's
    // WASAPI capture resampler produces audible artifacts ("robotic" voice), while
    // libwebrtc resamples the pushed frames cleanly. Playback keeps 48 kHz — the render
    // side of the driver resampler is fine.
    this.inRate = inDev ? nativeCaptureRate(inDev.info) : SAMPLE_RATE;
    this.inFrames = this.inRate / 100;
    this.resetChunkers();

    const inParams = inDev ? { deviceId: inDev.info.id, nChannels: inDev.channels, firstChannel: 0 } : null;
    const outParams = outDev ? { deviceId: outDev.info.id, nChannels: outDev.channels, firstChannel: 0 } : null;

    const onError = (type: number, msg: string) => {
      // The callback is shared by every RtAudio instance; warnings (e.g. a collected
      // instance closing a stream it never opened) must not restart the pipeline.
      if (type < RT_FIRST_REAL_ERROR) callbacks.onDebug?.(`RtAudio warning: ${msg}`);
      else callbacks.onError?.(`RtAudio: ${msg}`);
    };

    if (inParams && outParams && this.inRate === SAMPLE_RATE) {
      // Preferred: one duplex stream, input and output share a clock.
      try {
        const rt = new audify.RtAudio(pickApi(audify));
        const period = rt.openStream(
          outParams,
          inParams,
          FORMAT_SINT16,
          SAMPLE_RATE,
          FRAME_SIZE,
          'openmeet',
          (data) => this.onInput(data),
          () => this.onPeriodPlayed(),
          STREAM_FLAGS,
          onError,
        );
        this.setPeriod(period);
        this.duplex = rt;
        callbacks.onDebug?.(
          `Audio (${rt.getApi()}): duplex ${inDev!.info.name} → ${outDev!.info.name}, period ${this.outPeriod}, in ${this.inChannels}ch out ${this.outChannels}ch`,
        );
        this.prime();
        rt.start();
        this.startStats();
        return;
      } catch (err) {
        callbacks.onDebug?.(
          `Duplex stream failed (${err instanceof Error ? err.message : err}); opening separate streams`,
        );
      }
    }

    // Fallback: separate streams (different drivers, or duplex unsupported).
    if (outParams) {
      const rt = new audify.RtAudio(pickApi(audify));
      const period = rt.openStream(
        outParams,
        null,
        FORMAT_SINT16,
        SAMPLE_RATE,
        FRAME_SIZE,
        'openmeet-out',
        null,
        () => this.onPeriodPlayed(),
        STREAM_FLAGS,
        onError,
      );
      this.setPeriod(period);
      this.output = rt;
      this.prime();
      rt.start();
    }
    if (inParams) {
      const rt = new audify.RtAudio(pickApi(audify));
      rt.openStream(
        null,
        inParams,
        FORMAT_SINT16,
        this.inRate,
        this.inFrames,
        'openmeet-in',
        (data) => this.onInput(data),
        null,
        STREAM_FLAGS,
        onError,
      );
      this.input = rt;
      rt.start();
    } else {
      // Output only: nothing clocks playback, use a timer.
      this.clockTimer = setInterval(() => this.feedOutput(), 10);
    }
    callbacks.onDebug?.(
      `Audio (${(this.output ?? this.input)?.getApi()}): split streams, in ${inDev?.info.name ?? 'none'} @ ${this.inRate} Hz, out ${outDev?.info.name ?? 'none'} @ ${SAMPLE_RATE} Hz`,
    );
    this.startStats();
  }

  /** Every 10 s (debug only): how often the input clock stalled and by how much. */
  private startStats(): void {
    if (!this.callbacks?.onDebug || this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      if (this.stallCount > 0) {
        this.callbacks?.onDebug?.(
          `Audio clock: ${this.stallCount} input gaps >30ms in last 10s (max ${Math.round(this.stallMaxMs)}ms), queue ${this.queuedPeriods}/${this.targetPeriods}`,
        );
      }
      this.stallCount = 0;
      this.stallMaxMs = 0;
    }, 10_000);
  }

  stop(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.lastInputAt = 0;
    for (const rt of [this.duplex, this.input, this.output]) {
      if (!rt) continue;
      try {
        if (rt.isStreamRunning()) rt.stop();
      } catch {}
      try {
        if (rt.isStreamOpen()) rt.closeStream();
      } catch {}
    }
    this.duplex = null;
    this.input = null;
    this.output = null;
    this.callbacks = null;
  }

  // ─── Device resolution ───────────────────────────────────────────────

  private enumerate(rt: RtAudioInstance): Array<{ info: RtDeviceInfo; id: string }> {
    const seen = new Map<string, number>();
    const result: Array<{ info: RtDeviceInfo; id: string }> = [];
    for (const info of rt.getDevices()) {
      // Numeric RtAudio ids change across reboots and hot-plugs; persist names instead,
      // disambiguating duplicates by order.
      const n = (seen.get(info.name) ?? 0) + 1;
      seen.set(info.name, n);
      result.push({ info, id: n === 1 ? info.name : `${info.name} (${n})` });
    }
    return result;
  }

  private resolve(
    rt: RtAudioInstance,
    all: Array<{ info: RtDeviceInfo; id: string }>,
    wanted: AudioDevice | undefined,
    type: 'input' | 'output',
  ): ResolvedDevice | null {
    const devices = all.filter(({ info }) => (type === 'input' ? info.inputChannels > 0 : info.outputChannels > 0));
    if (devices.length === 0) return null;

    let match = wanted ? devices.find((d) => d.id === wanted.id || d.info.name === wanted.name) : undefined;
    if (wanted && !match) {
      this.callbacks?.onDebug?.(`Audio ${type} device "${wanted.name}" not found, using default`);
    }
    if (!match) {
      const defaultId = type === 'input' ? rt.getDefaultInputDevice() : rt.getDefaultOutputDevice();
      match = devices.find((d) => d.info.id === defaultId) ?? devices[0];
    }
    const available = type === 'input' ? match.info.inputChannels : match.info.outputChannels;
    return { info: match.info, channels: Math.min(CHANNELS, available) };
  }

  // ─── Capture path ────────────────────────────────────────────────────

  private resetChunkers(): void {
    this.inAccum = new Int16Array(this.inFrames * this.inChannels * 4);
    this.inAccumLen = 0;
    if (this.captureFrame.length !== this.inFrames * CHANNELS)
      this.captureFrame = new Int16Array(this.inFrames * CHANNELS);
    this.outAccum = new Int16Array(0);
    this.outAccumLen = 0;
    this.queuedPeriods = 0;
  }

  /** Queue depth is defined in milliseconds; convert once the driver period is known. */
  private setPeriod(period: number): void {
    this.outPeriod = period || FRAME_SIZE;
    const periodMs = (this.outPeriod * 1000) / SAMPLE_RATE;
    this.targetPeriods = Math.max(1, Math.ceil(TARGET_QUEUE_MS / periodMs));
    this.maxPeriods = Math.max(this.targetPeriods + 1, Math.ceil(MAX_QUEUE_MS / periodMs));
  }

  private onInput(data: Buffer): void {
    const cb = this.callbacks;
    if (!cb) return;
    const now = performance.now();
    if (this.lastInputAt > 0) {
      const gap = now - this.lastInputAt;
      if (gap > 30) {
        this.stallCount++;
        if (gap > this.stallMaxMs) this.stallMaxMs = gap;
      }
    }
    this.lastInputAt = now;
    const incoming = new Int16Array(data.buffer, data.byteOffset, data.byteLength >> 1);
    const perFrame = this.inFrames * this.inChannels;

    // Accumulate the driver period and emit whole 10 ms chunks.
    if (this.inAccumLen + incoming.length > this.inAccum.length) {
      const grown = new Int16Array((this.inAccumLen + incoming.length) * 2);
      grown.set(this.inAccum.subarray(0, this.inAccumLen));
      this.inAccum = grown;
    }
    this.inAccum.set(incoming, this.inAccumLen);
    this.inAccumLen += incoming.length;

    let offset = 0;
    while (this.inAccumLen - offset >= perFrame) {
      const chunk = this.inAccum.subarray(offset, offset + perFrame);
      if (this.inChannels === 2) this.captureFrame.set(chunk);
      else upmixMonoToStereo(chunk, this.captureFrame, this.inFrames);
      cb.onCapture(this.captureFrame, this.inRate);
      offset += perFrame;
      // In duplex (and split) mode the input clock drives the output queue.
      if (!this.clockTimer) this.feedOutput();
    }
    if (offset > 0) {
      this.inAccum.copyWithin(0, offset, this.inAccumLen);
      this.inAccumLen -= offset;
    }
  }

  // ─── Playback path ───────────────────────────────────────────────────

  private get outputStream(): RtAudioInstance | null {
    return this.duplex ?? this.output;
  }

  /** Pre-load the driver queue with silence so the first callbacks have something to play. */
  private prime(): void {
    const out = this.outputStream;
    if (!out) return;
    const bytes = this.outPeriod * this.outChannels * 2;
    for (let i = 0; i < this.targetPeriods; i++) {
      out.write(Buffer.alloc(bytes));
      this.queuedPeriods++;
    }
  }

  private onPeriodPlayed(): void {
    if (this.queuedPeriods > 0) this.queuedPeriods--;
    // If the queue drained completely (event-loop stall) the input clock alone would
    // never catch up, so top it back up here.
    if (this.queuedPeriods === 0) this.feedOutput();
  }

  /** Mix and enqueue one driver period, keeping the queue near the target depth. */
  private feedOutput(): void {
    const out = this.outputStream;
    const cb = this.callbacks;
    if (!out || !cb) return;
    if (this.queuedPeriods >= this.maxPeriods) return; // stall recovery: don't pile up latency

    const periodSamples = this.outPeriod * this.outChannels;
    while (this.outAccumLen < periodSamples) {
      cb.onPlayback(this.playbackFrame);
      const needed = this.outAccumLen + FRAME_SIZE * this.outChannels;
      if (needed > this.outAccum.length) {
        const grown = new Int16Array(needed * 2);
        grown.set(this.outAccum.subarray(0, this.outAccumLen));
        this.outAccum = grown;
      }
      if (this.outChannels === 2) this.outAccum.set(this.playbackFrame, this.outAccumLen);
      else downmixStereoToMono(this.playbackFrame, this.outAccum, FRAME_SIZE, this.outAccumLen);
      this.outAccumLen += FRAME_SIZE * this.outChannels;
    }

    // audify copies the buffer synchronously inside write(), so a view is enough.
    out.write(Buffer.from(this.outAccum.buffer, this.outAccum.byteOffset, periodSamples * 2));
    this.queuedPeriods++;
    this.outAccum.copyWithin(0, periodSamples, this.outAccumLen);
    this.outAccumLen -= periodSamples;

    // Keep a small cushion so a late callback doesn't underrun.
    if (this.queuedPeriods < this.targetPeriods) this.feedOutput();
  }
}
