import { type ChildProcess, spawn } from 'node:child_process';
import type { DeviceEnvs } from './devices.js';

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 480; // 10ms at 48kHz
const BYTES_PER_FRAME = FRAME_SIZE * 2;

function buildEnv(extra: Record<string, string>): Record<string, string> | undefined {
  if (Object.keys(extra).length === 0) return undefined;
  return { ...(process.env as Record<string, string>), ...extra };
}

function computeRMS(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

export type LevelCallback = (rms: number) => void;

/**
 * Records from the selected input device and reports RMS levels via callback.
 * Used for the mic test in the device picker — no WebRTC involved.
 */
export class MicTester {
  private process: ChildProcess | null = null;
  private onLevel: LevelCallback | null = null;

  setLevelCallback(cb: LevelCallback): void {
    this.onLevel = cb;
  }

  start(envs: DeviceEnvs): void {
    this.stop();

    const cmd = envs.recDeviceName ? 'sox' : 'rec';
    const args = envs.recDeviceName
      ? [
          '-q',
          '-t',
          'coreaudio',
          envs.recDeviceName,
          '-t',
          'raw',
          '-b',
          '16',
          '-e',
          'signed-integer',
          '-c',
          '1',
          '-r',
          String(SAMPLE_RATE),
          '-',
        ]
      : ['-q', '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', String(SAMPLE_RATE), '-'];

    this.process = spawn(cmd, args, {
      env: buildEnv(envs.recExtra),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = Buffer.alloc(0);

    this.process.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= BYTES_PER_FRAME) {
        const frameBuffer = buffer.subarray(0, BYTES_PER_FRAME);
        buffer = buffer.subarray(BYTES_PER_FRAME);
        const samples = new Int16Array(FRAME_SIZE);
        for (let i = 0; i < FRAME_SIZE; i++) {
          samples[i] = frameBuffer.readInt16LE(i * 2);
        }
        this.onLevel?.(computeRMS(samples));
      }
    });

    this.process.on('error', () => {});
    this.process.on('close', () => {
      this.process = null;
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

/** Plays a short test tone (880 Hz, 0.5s) through the selected output device. */
export function playTestTone(envs: DeviceEnvs): void {
  const cmd = envs.playDeviceName ? 'sox' : 'play';
  const args = envs.playDeviceName
    ? [
        '-q',
        '-n',
        '-t',
        'coreaudio',
        envs.playDeviceName,
        'synth',
        '0.5',
        'sine',
        '880',
        'fade',
        'h',
        '0.05',
        '0.5',
        '0.05',
      ]
    : ['-q', '-n', 'synth', '0.5', 'sine', '880', 'fade', 'h', '0.05', '0.5', '0.05'];

  const proc = spawn(cmd, args, {
    env: buildEnv(envs.playExtra),
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  proc.on('error', () => {});
}
