/**
 * TUI-side handle on the engine process. One engine per app run, created by the CLI entry
 * before any UI renders, and killed when the TUI exits.
 */
import { type ChildProcess, fork } from 'node:child_process';
import type { AudioDeviceList } from '../lib/audio/backend.js';
import type { EngineCommand, EngineEvent } from './protocol.js';

type Listener = (event: EngineEvent) => void;

export class EngineClient {
  private child: ChildProcess | null = null;
  private readonly listeners = new Set<Listener>();
  private nextRequestId = 1;
  private readonly extraArgs: string[];
  private lastFatal: string | null = null;

  constructor(extraArgs: string[]) {
    this.extraArgs = extraArgs;
  }

  private ensure(): ChildProcess {
    if (this.child) return this.child;
    // Same bundle (or the same tsx entry in dev), switched into engine mode by the flag.
    // execArgv is inherited, so `tsx` dev mode keeps working in the child.
    const child = fork(process.argv[1], ['--engine', ...this.extraArgs], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    child.on('message', (event: EngineEvent) => {
      if (event.type === 'fatal') this.lastFatal = event.message;
      this.dispatch(event);
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return; // disposed on purpose
      this.child = null;
      const reason = this.lastFatal
        ? `Audio engine crashed: ${this.lastFatal}`
        : `Audio engine exited (${signal ?? code})`;
      this.dispatch({ type: 'engine-exited', reason });
    });
    child.on('error', () => {});
    this.child = child;
    return child;
  }

  private dispatch(event: EngineEvent): void {
    for (const l of this.listeners) l(event);
  }

  /** Start the engine ahead of time so the first device listing / join is instant. */
  start(): void {
    this.ensure();
  }

  send(cmd: EngineCommand): void {
    try {
      this.ensure().send(cmd);
    } catch {
      // Channel closed; the exit handler reports it.
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listDevices(): Promise<AudioDeviceList> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const finish = (list: AudioDeviceList) => {
        clearTimeout(timer);
        unsub();
        resolve(list);
      };
      const unsub = this.subscribe((event) => {
        if (event.type === 'devices' && event.requestId === requestId) finish(event);
      });
      // Never hang the UI if the engine died mid-request.
      const timer = setTimeout(() => finish({ inputs: [], outputs: [] }), 10_000);
      this.send({ type: 'list-devices', requestId });
    });
  }

  /** Stop the engine. Idempotent. */
  dispose(): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try {
      child.send({ type: 'shutdown' } satisfies EngineCommand);
    } catch {}
    try {
      child.disconnect();
    } catch {}
    // Belt and braces: if it hasn't exited on its own shortly, kill it.
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 1500);
    killer.unref();
    child.once('exit', () => clearTimeout(killer));
  }
}

let shared: EngineClient | null = null;

/** Create the singleton. Called once from the CLI entry before any UI renders. */
export function initEngineClient(extraArgs: string[]): EngineClient {
  shared = new EngineClient(extraArgs);
  return shared;
}

export function getEngine(): EngineClient {
  if (!shared) throw new Error('Engine client not initialised (initEngineClient must run before the UI)');
  return shared;
}

/** UI-side device listing: always via the engine so the native audio module never loads here. */
export function listAudioDevices(): Promise<AudioDeviceList> {
  return getEngine().listDevices();
}

export type { AudioDevice, AudioDeviceSelection } from '../lib/audio/backend.js';
