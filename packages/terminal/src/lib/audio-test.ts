/**
 * Mic level meter and test tone for the device pickers. Both run in the engine process;
 * this module is just the TUI-side remote control.
 */
import { getEngine } from '../engine/client.js';
import type { AudioDeviceSelection } from './audio/backend.js';
import { loadSettings } from './settings.js';

export type LevelCallback = (rms: number) => void;

export class MicTester {
  private onLevel: LevelCallback | null = null;
  private unsubscribe: (() => void) | null = null;

  setLevelCallback(cb: LevelCallback): void {
    this.onLevel = cb;
  }

  start(selection: AudioDeviceSelection): void {
    this.stop();
    const engine = getEngine();
    this.unsubscribe = engine.subscribe((event) => {
      if (event.type === 'mic-level') this.onLevel?.(event.rms);
    });
    const s = loadSettings();
    engine.send({
      type: 'mic-test-start',
      selection,
      input: { channels: s.audioInputChannels, gainDb: s.audioInputGainDb, voiceGate: s.voiceGate },
    });
  }

  stop(): void {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    getEngine().send({ type: 'mic-test-stop' });
  }
}

/** Plays a short test tone (880 Hz, 0.5 s) through the selected output device. */
export function playTestTone(selection: AudioDeviceSelection): void {
  getEngine().send({ type: 'play-test-tone', selection });
}
