import { type ChildProcess, execFile, execSync, spawn } from 'node:child_process';
import { createWriteStream, unlinkSync, type WriteStream } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AudioBackend, AudioDevice, AudioDeviceSelection, AudioStreamCallbacks } from './backend.js';
import { CHANNELS, FRAME_BYTES, FRAME_SAMPLES, FRAME_SIZE, SAMPLE_RATE } from './constants.js';

/** Bytes of queued playback we tolerate in the FIFO before skipping writes (~150 ms). */
const MAX_PLAYBACK_BUFFER = SAMPLE_RATE * CHANNELS * 2 * 0.15;

/** Frames of capture we tolerate in the pipe before dropping stale audio (~80 ms). */
const MAX_CAPTURE_BACKLOG_FRAMES = 8;

/** Skip a capture frame when the pipe delivered audio this far ahead of wall-clock. */
const MAX_DRIFT_MS = 50;

/** Playback runs this many frames ahead of wall-clock so a late timer tick never starves `play`. */
const PLAYBACK_LEAD_FRAMES = 3;

interface SoxDeviceArgs {
  /** Extra env for `rec` / `play` (Linux PulseAudio routing). */
  recEnv: Record<string, string>;
  playEnv: Record<string, string>;
  /** macOS CoreAudio device names for `sox -t coreaudio <name>`. */
  recDeviceName?: string;
  playDeviceName?: string;
}

function buildEnv(extra: Record<string, string>): Record<string, string> | undefined {
  if (Object.keys(extra).length === 0) return undefined;
  return { ...(process.env as Record<string, string>), ...extra };
}

function deviceArgs(selection: AudioDeviceSelection): SoxDeviceArgs {
  const os = platform();
  const args: SoxDeviceArgs = { recEnv: {}, playEnv: {} };
  if (os === 'darwin') {
    // AUDIODEV is broken for coreaudio; pass the device name explicitly.
    if (selection.input) args.recDeviceName = selection.input.name;
    if (selection.output) args.playDeviceName = selection.output.name;
  } else if (os === 'linux') {
    if (selection.input) args.recEnv.PULSE_SOURCE = selection.input.id;
    if (selection.output) args.playEnv.PULSE_SINK = selection.output.id;
  }
  return args;
}

const execFileAsync = promisify(execFile);

const RAW_FORMAT = ['-t', 'raw', '-b', '16', '-e', 'signed-integer', '-r', String(SAMPLE_RATE)];

/**
 * Legacy backend: `rec` piped into Node for capture, one `play` process reading a FIFO for
 * playback. macOS and Linux only (needs mkfifo and sox on PATH).
 */
export class SoxBackend implements AudioBackend {
  readonly name = 'sox' as const;
  private recProcess: ChildProcess | null = null;
  private playProcess: ChildProcess | null = null;
  private fifoPath: string | null = null;
  private fifoStream: WriteStream | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private playbackStartMs = 0;
  private framesWritten = 0;
  private callbacks: AudioStreamCallbacks | null = null;
  private readonly playbackFrame = new Int16Array(FRAME_SAMPLES);
  private _running = false;

  async listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
    // Enumeration runs in the engine process alongside live audio: never block here.
    const os = platform();
    if (os === 'darwin') return listMacOSDevices();
    if (os === 'linux') return listLinuxDevices();
    return { inputs: [], outputs: [] };
  }

  async start(selection: AudioDeviceSelection, callbacks: AudioStreamCallbacks): Promise<void> {
    if (platform() === 'win32') {
      throw new Error('The sox audio backend is not available on Windows; use --audio-backend rtaudio');
    }
    this.stop();
    this.callbacks = callbacks;
    const args = deviceArgs(selection);
    this.startPlayback(args);
    this.startCapture(args);
    this._running = true;
  }

  stop(): void {
    this._running = false;
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.recProcess) {
      this.recProcess.kill();
      this.recProcess = null;
    }
    if (this.fifoStream) {
      this.fifoStream.end();
      this.fifoStream = null;
    }
    if (this.playProcess) {
      this.playProcess.kill();
      this.playProcess = null;
    }
    this.removeFifo();
    this.callbacks = null;
  }

  // ─── Capture ─────────────────────────────────────────────────────────

  private startCapture(args: SoxDeviceArgs): void {
    const cmd = args.recDeviceName ? 'sox' : 'rec';
    const cmdArgs = args.recDeviceName
      ? ['-q', '-t', 'coreaudio', args.recDeviceName, ...RAW_FORMAT, '-c', String(CHANNELS), '-']
      : ['-q', ...RAW_FORMAT, '-c', String(CHANNELS), '-'];

    const proc = spawn(cmd, cmdArgs, { env: buildEnv(args.recEnv), stdio: ['ignore', 'pipe', 'ignore'] });
    this.recProcess = proc;

    let buffer = Buffer.alloc(0);
    let captureStartMs = Date.now();
    let framesPushed = 0;
    const frame = new Int16Array(FRAME_SAMPLES);

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (this.recProcess !== proc) return;
      buffer = Buffer.concat([buffer, chunk]);

      // When the event loop stalls (TUI renders, WS bursts) rec keeps filling the pipe.
      // Pushing the backlog to WebRTC faster than real-time would add delay that never
      // recovers, so keep only the most recent ~20 ms.
      const backlog = Math.floor(buffer.length / FRAME_BYTES);
      if (backlog > MAX_CAPTURE_BACKLOG_FRAMES) {
        const keep = 2;
        buffer = buffer.subarray((backlog - keep) * FRAME_BYTES);
        captureStartMs = Date.now();
        framesPushed = 0;
        this.callbacks?.onDebug?.(`Audio capture backlog, dropped ${backlog - keep} frames`);
      }

      while (buffer.length >= FRAME_BYTES) {
        const raw = buffer.subarray(0, FRAME_BYTES);
        buffer = buffer.subarray(FRAME_BYTES);
        for (let i = 0; i < FRAME_SAMPLES; i++) frame[i] = raw.readInt16LE(i * 2);

        // The pipe decouples us from the device clock; if audio arrives ahead of wall-clock
        // for long enough, skip a frame instead of letting delay creep up.
        framesPushed++;
        const audioMs = (framesPushed * FRAME_SIZE * 1000) / SAMPLE_RATE;
        if (audioMs - (Date.now() - captureStartMs) > MAX_DRIFT_MS) {
          this.callbacks?.onDebug?.('Audio drift guard: skipping frame');
          continue;
        }

        this.callbacks?.onCapture(frame, SAMPLE_RATE);
      }
    });

    proc.on('error', (err) => this.callbacks?.onError?.(`sox capture failed: ${err.message}`));
    proc.on('close', () => {
      if (this.recProcess === proc) {
        this.recProcess = null;
        this.callbacks?.onDebug?.('Audio capture stopped');
      }
    });
  }

  // ─── Playback ────────────────────────────────────────────────────────

  private startPlayback(args: SoxDeviceArgs): void {
    // Node's spawn() pipes are non-blocking and sox treats EAGAIN as EOF, so feed it a FIFO.
    const fifoPath = join(tmpdir(), `openmeet-audio-${process.pid}-${Date.now()}`);
    try {
      execSync(`mkfifo "${fifoPath}"`);
    } catch {
      this.callbacks?.onError?.('Could not create playback FIFO');
      return;
    }
    this.fifoPath = fifoPath;

    const cmd = args.playDeviceName ? 'sox' : 'play';
    const cmdArgs = args.playDeviceName
      ? ['-q', ...RAW_FORMAT, '-c', String(CHANNELS), fifoPath, '-t', 'coreaudio', args.playDeviceName]
      : ['-q', ...RAW_FORMAT, '-c', String(CHANNELS), fifoPath];

    const proc = spawn(cmd, cmdArgs, { env: buildEnv(args.playEnv), stdio: ['ignore', 'ignore', 'ignore'] });
    this.playProcess = proc;
    this.fifoStream = createWriteStream(fifoPath);
    this.fifoStream.on('error', () => {});
    proc.on('error', (err) => this.callbacks?.onError?.(`sox playback failed: ${err.message}`));
    proc.on('close', () => {
      if (this.playProcess === proc) {
        this.playProcess = null;
        this.removeFifo();
      }
    });
    this.callbacks?.onDebug?.('Audio playback started (sox, stereo)');

    // Playback is paced by wall-clock, not by capture: `rec` delivers its pipe in bursts
    // and on a different device clock, and clocking the mixer from it produced a glitch
    // every few frames. A short timer tops the FIFO up to exactly real-time plus a small
    // lead; `play` drains it at the device rate and the OS pipe absorbs the timer jitter.
    this.playbackStartMs = performance.now();
    this.framesWritten = 0;
    this.clockTimer = setInterval(() => this.tickPlayback(), 5);
  }

  private tickPlayback(): void {
    const stream = this.fifoStream;
    if (!stream?.writable || !this.callbacks) return;
    const due = Math.floor((performance.now() - this.playbackStartMs) / 10) + PLAYBACK_LEAD_FRAMES;
    while (this.framesWritten < due) {
      // Node only buffers here when the OS pipe is full, i.e. `play` has fallen far behind
      // (or died): drop what is due instead of building latency that never recovers.
      if (stream.writableLength >= MAX_PLAYBACK_BUFFER) {
        this.framesWritten = due;
        break;
      }
      this.callbacks.onPlayback(this.playbackFrame);
      // Copy: the stream may queue the chunk and write it later, and playbackFrame is
      // reused on the next tick. Writing a view here corrupted every queued frame.
      stream.write(Buffer.from(this.playbackFrame.buffer.slice(0, this.playbackFrame.byteLength)));
      this.framesWritten++;
    }
  }

  private removeFifo(): void {
    if (this.fifoPath) {
      try {
        unlinkSync(this.fifoPath);
      } catch {}
      this.fifoPath = null;
    }
  }
}

// ─── Device enumeration ──────────────────────────────────────────────

async function listMacOSDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];
  try {
    const { stdout: json } = await execFileAsync('system_profiler', ['SPAudioDataType', '-json'], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const data = JSON.parse(json);
    for (const section of data.SPAudioDataType ?? []) {
      for (const device of section._items ?? []) {
        const name = device._name;
        if (!name) continue;
        if (device.coreaudio_device_input) {
          inputs.push({
            id: name,
            name,
            type: 'input',
            isDefault: device.coreaudio_default_audio_input_device === 'spaudio_yes',
          });
        }
        if (device.coreaudio_device_output) {
          outputs.push({
            id: name,
            name,
            type: 'output',
            isDefault: device.coreaudio_default_audio_output_device === 'spaudio_yes',
          });
        }
      }
    }
  } catch {
    // system_profiler not available
  }
  return { inputs, outputs };
}

async function listLinuxDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];
  const parse = (raw: string, type: 'input' | 'output', list: AudioDevice[]) => {
    for (const line of raw.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const id = parts[1];
      if (type === 'input' && id.includes('.monitor')) continue;
      list.push({ id, name: id, type });
    }
  };
  const [sources, sinks] = await Promise.allSettled([
    execFileAsync('pactl', ['list', 'sources', 'short'], { encoding: 'utf-8' }),
    execFileAsync('pactl', ['list', 'sinks', 'short'], { encoding: 'utf-8' }),
  ]);
  if (sources.status === 'fulfilled') parse(sources.value.stdout, 'input', inputs);
  if (sinks.status === 'fulfilled') parse(sinks.value.stdout, 'output', outputs);
  return { inputs, outputs };
}
