import { platform } from 'node:os';
import type { AudioBackend, AudioDevice, AudioDeviceSelection, AudioStreamCallbacks } from './backend.js';
import {
  CHANNELS,
  downmixStereoToMono,
  FRAME_SAMPLES,
  FRAME_SIZE,
  framesPer10ms,
  SAMPLE_RATE,
  upmixMonoToStereo,
} from './constants.js';
import { Resampler } from './resampler.js';

// audify (RtAudio) types — imported lazily so machines using sox never load the native addon.
type AudifyModule = typeof import('audify');
type RtAudioInstance = InstanceType<AudifyModule['RtAudio']>;
type RtDeviceInfo = ReturnType<RtAudioInstance['getDevices']>[number];
type RtStreamParams = Parameters<RtAudioInstance['openStream']>[0];

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

/** A device entry as exposed to the UI: multichannel interfaces appear once per channel pair. */
interface Entry {
  info: RtDeviceInfo;
  /** Display name, also the persisted id. */
  name: string;
  firstChannel: number;
  channels: number;
  type: 'input' | 'output';
}

interface ResolvedDevice {
  entry: Entry;
  rate: number;
}

/**
 * The rate to open a stream at: the device's preferred (shared-mode / nominal) rate. We
 * resample in-process, so the driver never converts and CoreAudio's nominal rate is left
 * as the user set it. Falls back to 48 kHz when the driver reports nothing usable.
 */
function nativeRate(info: RtDeviceInfo): number {
  const rate = info.preferredSampleRate;
  if (!rate || rate < 8000) return SAMPLE_RATE;
  if (info.sampleRates.length > 0 && !info.sampleRates.includes(rate)) return SAMPLE_RATE;
  return rate;
}

/** Growable Int16 FIFO used to re-chunk between the driver period and 10 ms frames. */
class SampleQueue {
  private buf: Int16Array;
  length = 0;

  constructor(initial: number) {
    this.buf = new Int16Array(initial);
  }

  append(samples: Int16Array): void {
    const needed = this.length + samples.length;
    if (needed > this.buf.length) {
      const grown = new Int16Array(needed * 2);
      grown.set(this.buf.subarray(0, this.length));
      this.buf = grown;
    }
    this.buf.set(samples, this.length);
    this.length += samples.length;
  }

  /** View of the first `n` samples (valid until the next append/consume). */
  peek(n: number): Int16Array {
    return this.buf.subarray(0, n);
  }

  /** Byte view of the first `n` samples (valid until the next append/consume). */
  peekBytes(n: number): Buffer {
    return Buffer.from(this.buf.buffer, this.buf.byteOffset, n * 2);
  }

  consume(n: number): void {
    this.buf.copyWithin(0, n, this.length);
    this.length -= n;
  }

  clear(): void {
    this.length = 0;
  }
}

/**
 * Native backend on top of audify (RtAudio): WASAPI on Windows, CoreAudio on macOS.
 * Streams open at each device's native rate and channel count; capture is resampled and
 * upmixed to the pipeline's 48 kHz stereo, playback is downmixed/resampled back. One duplex
 * stream when input and output share a rate, otherwise separate streams.
 */
export class RtAudioBackend implements AudioBackend {
  readonly name = 'rtaudio' as const;
  private duplex: RtAudioInstance | null = null;
  private input: RtAudioInstance | null = null;
  private output: RtAudioInstance | null = null;
  private callbacks: AudioStreamCallbacks | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  // Capture: driver period at native rate/channels → [resample] → 480-frame stereo at 48 kHz
  private inChannels = CHANNELS;
  private inResampler: Resampler | null = null;
  private readonly inQueue = new SampleQueue(FRAME_SAMPLES * 4);
  private readonly captureFrame = new Int16Array(FRAME_SAMPLES);

  // Playback: 480-frame stereo at 48 kHz → [downmix][resample] → driver period at native rate/channels
  private outChannels = CHANNELS;
  private outResampler: Resampler | null = null;
  private outPeriod = FRAME_SIZE;
  private readonly outQueue = new SampleQueue(FRAME_SAMPLES * 4);
  private readonly playbackFrame = new Int16Array(FRAME_SAMPLES);
  private readonly playbackMono = new Int16Array(FRAME_SIZE);
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
    const entries = this.enumerate(getProbe(audify));
    const toDevice = (e: Entry): AudioDevice => ({
      id: e.name,
      name: e.name,
      type: e.type,
      isDefault: e.firstChannel === 0 && !!(e.type === 'input' ? e.info.isDefaultInput : e.info.isDefaultOutput),
      firstChannel: e.firstChannel,
    });
    return {
      inputs: entries.filter((e) => e.type === 'input').map(toDevice),
      outputs: entries.filter((e) => e.type === 'output').map(toDevice),
    };
  }

  async start(selection: AudioDeviceSelection, callbacks: AudioStreamCallbacks): Promise<void> {
    this.stop();
    const audify = await loadAudify();
    this.callbacks = callbacks;

    const probe = getProbe(audify);
    const entries = this.enumerate(probe); // one native sweep for both lookups
    const inDev = this.resolve(probe, entries, selection.input, 'input');
    const outDev = this.resolve(probe, entries, selection.output, 'output');
    if (!inDev && !outDev) throw new Error('No audio devices found');

    const inRate = inDev?.rate ?? SAMPLE_RATE;
    const outRate = outDev?.rate ?? SAMPLE_RATE;
    this.inChannels = inDev?.entry.channels ?? CHANNELS;
    this.outChannels = outDev?.entry.channels ?? CHANNELS;
    this.inResampler = inRate === SAMPLE_RATE ? null : new Resampler(inRate, SAMPLE_RATE, this.inChannels);
    this.outResampler = outRate === SAMPLE_RATE ? null : new Resampler(SAMPLE_RATE, outRate, this.outChannels);
    this.inQueue.clear();
    this.outQueue.clear();
    this.queuedPeriods = 0;

    const params = (d: ResolvedDevice): RtStreamParams => ({
      deviceId: d.entry.info.id,
      nChannels: d.entry.channels,
      firstChannel: d.entry.firstChannel,
    });
    const describe = (d: ResolvedDevice | null) =>
      d ? `${d.entry.name} @ ${d.rate} Hz ${d.entry.channels}ch` : 'none';
    const onError = (type: number, msg: string) => {
      // The callback is shared by every RtAudio instance; warnings (e.g. a collected
      // instance closing a stream it never opened) must not restart the pipeline.
      if (type < RT_FIRST_REAL_ERROR) callbacks.onDebug?.(`RtAudio warning: ${msg}`);
      else callbacks.onError?.(`RtAudio: ${msg}`);
    };
    /** Open one stream at `rate` with 10 ms periods; returns it and the period the driver granted. */
    const open = (label: string, out: ResolvedDevice | null, inp: ResolvedDevice | null, rate: number) => {
      const rt = new audify.RtAudio(pickApi(audify));
      const period = rt.openStream(
        out ? params(out) : null,
        inp ? params(inp) : null,
        FORMAT_SINT16,
        rate,
        framesPer10ms(rate),
        label,
        inp ? (data) => this.onInput(data) : null,
        out ? () => this.onPeriodPlayed() : null,
        STREAM_FLAGS,
        onError,
      );
      return { rt, period };
    };

    if (inDev && outDev && inRate === outRate) {
      // Preferred: one duplex stream, input and output share a clock.
      try {
        const { rt, period } = open('openmeet', outDev, inDev, outRate);
        this.setPeriod(period, outRate);
        this.duplex = rt;
        callbacks.onDebug?.(
          `Audio (${rt.getApi()}): duplex in ${describe(inDev)}, out ${describe(outDev)}, period ${this.outPeriod}`,
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

    // Separate streams: different rates, different drivers, or duplex unsupported.
    if (outDev) {
      const { rt, period } = open('openmeet-out', outDev, null, outRate);
      this.setPeriod(period, outRate);
      this.output = rt;
      this.prime();
      rt.start();
    }
    if (inDev) {
      const { rt } = open('openmeet-in', null, inDev, inRate);
      this.input = rt;
      rt.start();
    } else {
      // Output only: nothing clocks playback, use a timer.
      this.clockTimer = setInterval(() => this.feedOutput(), 10);
    }
    callbacks.onDebug?.(
      `Audio (${(this.output ?? this.input)?.getApi()}): split streams, in ${describe(inDev)}, out ${describe(outDev)}`,
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
    this.inResampler = null;
    this.outResampler = null;
    this.callbacks = null;
  }

  // ─── Device resolution ───────────────────────────────────────────────

  /**
   * Numeric RtAudio ids change across reboots and hot-plugs, so ids are names (duplicates
   * disambiguated by order). Interfaces with more than two channels get one entry per
   * stereo pair — "Scarlett 18i8 [ch 3-4]" — so a mic plugged into input 3 is reachable.
   */
  private enumerate(rt: RtAudioInstance): Entry[] {
    const seen = new Map<string, number>();
    const result: Entry[] = [];
    for (const info of rt.getDevices()) {
      const n = (seen.get(info.name) ?? 0) + 1;
      seen.set(info.name, n);
      const base = n === 1 ? info.name : `${info.name} (${n})`;
      for (const type of ['input', 'output'] as const) {
        const total = type === 'input' ? info.inputChannels : info.outputChannels;
        if (total <= 0) continue;
        if (total <= CHANNELS) {
          result.push({ info, name: base, firstChannel: 0, channels: total, type });
          continue;
        }
        for (let first = 0; first < total; first += CHANNELS) {
          const channels = Math.min(CHANNELS, total - first);
          const label = channels === 2 ? `ch ${first + 1}-${first + 2}` : `ch ${first + 1}`;
          result.push({ info, name: `${base} [${label}]`, firstChannel: first, channels, type });
        }
      }
    }
    return result;
  }

  private resolve(
    rt: RtAudioInstance,
    all: Entry[],
    wanted: AudioDevice | undefined,
    type: 'input' | 'output',
  ): ResolvedDevice | null {
    const entries = all.filter((e) => e.type === type);
    if (entries.length === 0) return null;

    let match = wanted
      ? (entries.find((e) => e.name === wanted.id) ??
        entries.find((e) => e.info.name === wanted.name && e.firstChannel === (wanted.firstChannel ?? 0)))
      : undefined;
    if (wanted && !match) {
      this.callbacks?.onDebug?.(`Audio ${type} device "${wanted.name}" not found, using default`);
    }
    if (!match) {
      const defaultId = type === 'input' ? rt.getDefaultInputDevice() : rt.getDefaultOutputDevice();
      match = entries.find((e) => e.info.id === defaultId && e.firstChannel === 0) ?? entries[0];
    }
    return { entry: match, rate: nativeRate(match.info) };
  }

  // ─── Capture path ────────────────────────────────────────────────────

  /** Queue depth is defined in milliseconds; convert once the driver period is known. */
  private setPeriod(period: number, rate: number): void {
    this.outPeriod = period || framesPer10ms(rate);
    const periodMs = (this.outPeriod * 1000) / rate;
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

    // Driver samples → 48 kHz samples (still inChannels wide), then whole 10 ms frames,
    // upmixing mono to the pipeline's stereo.
    const raw = new Int16Array(data.buffer, data.byteOffset, data.byteLength >> 1);
    this.inQueue.append(this.inResampler ? this.inResampler.process(raw) : raw);
    const perFrame = FRAME_SIZE * this.inChannels;
    while (this.inQueue.length >= perFrame) {
      const chunk = this.inQueue.peek(perFrame);
      if (this.inChannels === 2) this.captureFrame.set(chunk);
      else upmixMonoToStereo(chunk, this.captureFrame, FRAME_SIZE);
      this.inQueue.consume(perFrame);
      cb.onCapture(this.captureFrame);
      // In duplex (and split) mode the input clock drives the output queue.
      if (!this.clockTimer) this.feedOutput();
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
    while (this.outQueue.length < periodSamples) {
      cb.onPlayback(this.playbackFrame);
      let frame: Int16Array = this.playbackFrame;
      if (this.outChannels === 1) {
        downmixStereoToMono(this.playbackFrame, this.playbackMono, FRAME_SIZE);
        frame = this.playbackMono;
      }
      this.outQueue.append(this.outResampler ? this.outResampler.process(frame) : frame);
    }

    // audify copies the buffer synchronously inside write(), so a view is enough.
    out.write(this.outQueue.peekBytes(periodSamples));
    this.outQueue.consume(periodSamples);
    this.queuedPeriods++;

    // Keep a small cushion so a late callback doesn't underrun.
    if (this.queuedPeriods < this.targetPeriods) this.feedOutput();
  }
}
