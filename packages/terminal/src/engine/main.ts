/**
 * Engine process entry point. Started by the TUI with `fork(<this bundle>, ['--engine'])`.
 *
 * Everything here runs on an event loop that never renders anything, so the 10 ms audio
 * cadence is only ever competing with signaling messages and a stats poll every 2 s.
 */

import { computeRMS } from '../lib/audio/constants.js';
import {
  type AudioBackend,
  type AudioDeviceList,
  type AudioDeviceSelection,
  createAudioBackend,
} from '../lib/audio/index.js';
import { ToneGenerator } from '../lib/audio/tone.js';
import type { EngineCommand, EngineEvent } from './protocol.js';
import { RoomEngine } from './room-engine.js';

/** Mic-test levels are sent at most this often (the meter itself updates every ~80 ms). */
const MIC_LEVEL_INTERVAL_MS = 50;

/**
 * Runs the engine until the TUI disconnects the IPC channel; the returned promise never
 * resolves because the process exits from inside (`process.exit`).
 */
export function runEngine(): Promise<never> {
  if (typeof process.send !== 'function') {
    process.stderr.write('The engine must be started by the openmeet TUI, not directly.\n');
    process.exit(2);
  }

  const send = (event: EngineEvent): void => {
    try {
      process.send?.(event);
    } catch {
      // Channel gone: the TUI is exiting, and so are we (see 'disconnect').
    }
  };

  const room = new RoomEngine(send);
  let micTest: AudioBackend | null = null;

  const stopMicTest = () => {
    micTest?.stop();
    micTest = null;
  };

  const exit = (code: number) => {
    stopMicTest();
    room.shutdown();
    // audify keeps its thread-safe callbacks registered until the object is collected,
    // which would keep this loop alive forever: exit explicitly.
    setTimeout(() => process.exit(code), 50);
  };

  process.on('disconnect', () => exit(0));
  process.on('SIGTERM', () => exit(0));
  process.on('SIGINT', () => {
    /* the TUI owns Ctrl+C; it will disconnect us */
  });
  process.on('uncaughtException', (err) => {
    room.log(`Engine crash: ${err.stack ?? err.message}`);
    send({ type: 'fatal', message: err.message });
    exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    room.log(`Engine unhandled rejection: ${message}`);
  });

  async function listDevices(): Promise<AudioDeviceList> {
    try {
      return await (await createAudioBackend()).listDevices();
    } catch (err) {
      room.log(`Device enumeration failed: ${err instanceof Error ? err.message : err}`);
      return { inputs: [], outputs: [] };
    }
  }

  async function startMicTest(selection: AudioDeviceSelection): Promise<void> {
    stopMicTest();
    let peak = 0;
    let lastSent = 0;
    try {
      const backend = await createAudioBackend();
      micTest = backend;
      await backend.start(selection, {
        onCapture: (samples) => {
          // Peak over the reporting window, sent a few times per second instead of 100/s.
          peak = Math.max(peak, computeRMS(samples));
          const now = Date.now();
          if (now - lastSent >= MIC_LEVEL_INTERVAL_MS) {
            send({ type: 'mic-level', rms: peak });
            peak = 0;
            lastSent = now;
          }
        },
        onPlayback: (out) => out.fill(0),
      });
    } catch (err) {
      room.log(`Mic test failed: ${err instanceof Error ? err.message : err}`);
      micTest = null;
    }
  }

  async function playTestTone(selection: AudioDeviceSelection): Promise<void> {
    const tone = new ToneGenerator({ hz: 880, seconds: 0.5, fadeSeconds: 0.05 });
    try {
      const backend = await createAudioBackend();
      await backend.start({ output: selection.output }, { onCapture: () => {}, onPlayback: (out) => tone.fill(out) });
      // Tone plus the driver's queued periods, then release the device.
      setTimeout(() => backend.stop(), 700);
    } catch (err) {
      room.log(`Test tone failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function handle(cmd: EngineCommand): Promise<void> {
    switch (cmd.type) {
      case 'list-devices':
        send({ type: 'devices', requestId: cmd.requestId, ...(await listDevices()) });
        break;
      case 'mic-test-start':
        await startMicTest(cmd.selection);
        break;
      case 'mic-test-stop':
        stopMicTest();
        break;
      case 'play-test-tone':
        await playTestTone(cmd.selection);
        break;
      case 'join':
        stopMicTest();
        room.join(cmd.options);
        break;
      case 'leave':
        room.leave();
        break;
      case 'send-chat':
        room.sendChat(cmd.content);
        break;
      case 'toggle-mute':
        room.toggleMute();
        break;
      case 'toggle-video':
        room.toggleVideo();
        break;
      case 'toggle-overlay':
        room.toggleOverlay();
        break;
      case 'start-screen-share':
        room.startScreenShare(cmd.device);
        break;
      case 'stop-screen-share':
        room.stopScreenShare();
        break;
      case 'toggle-peer-video':
        room.togglePeerVideo(cmd.peerId);
        break;
      case 'toggle-peer-screen':
        room.togglePeerScreen(cmd.peerId);
        break;
      case 'set-peer-volume':
        room.setPeerVolume(cmd.peerId, cmd.volume);
        break;
      case 'update-devices':
        room.updateDevices(cmd.selection);
        break;
      case 'toggle-debug':
        room.toggleDebug();
        break;
      case 'log':
        room.log(cmd.message);
        break;
      case 'shutdown':
        exit(0);
        break;
    }
  }

  process.on('message', (cmd: EngineCommand) => {
    void handle(cmd);
  });

  send({ type: 'ready', pid: process.pid });
  // Keep the loop alive even before any stream or socket exists.
  setInterval(() => {}, 60_000);
  return new Promise<never>(() => {});
}
