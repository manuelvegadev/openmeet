/**
 * The voice gate, without a microphone:
 *   pnpm --filter openmeet-terminal exec tsx scripts/voice-gate-test.ts
 *
 * What has to hold for a gate to be allowed in front of someone's voice: it never opens on
 * a silent or merely noisy room, it always opens on a normal voice, it opens on a quiet one
 * once it has heard how quiet the room is, the front of the word survives, and a pause
 * between words does not cut the sentence in two.
 */
import { FRAME_SAMPLES, SPEAKING_RMS_THRESHOLD } from '../src/lib/audio/constants.js';
import { VoiceGate } from '../src/lib/audio/voice-gate.js';
import { check, finish } from './harness.js';

const FRAME_MS = 10;
const frame = new Int16Array(FRAME_SAMPLES);

/** Run `ms` of audio at a constant level through the gate; returns how many frames went out. */
function run(gate: VoiceGate, rms: number, ms: number, clock: { now: number }): number {
  let sent = 0;
  for (let t = 0; t < ms; t += FRAME_MS) {
    sent += gate.step(frame, rms, clock.now).length;
    clock.now += FRAME_MS;
  }
  return sent;
}

const SPEECH = SPEAKING_RMS_THRESHOLD * 2;
const QUIET_ROOM = 8;
const NOISY_ROOM = 200;

// ── a silent room ───────────────────────────────────────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  const sent = run(gate, QUIET_ROOM, 2000, clock);
  check('silence never opens the gate', sent, 0);
  check('...and it stays shut', gate.isOpen, false);
}

// ── a normal voice ──────────────────────────────────────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  run(gate, QUIET_ROOM, 500, clock);
  const first = gate.step(frame, SPEECH, clock.now).length;
  clock.now += FRAME_MS;
  check('a voice opens the gate on its first frame', gate.isOpen, true);
  check('...and the attack waiting behind it goes out with it', first, 5);
  const sent = run(gate, SPEECH, 1000, clock);
  check('...after which one frame goes out per frame captured', sent, 100);
}

// ── a pause between two words ───────────────────────────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  run(gate, QUIET_ROOM, 500, clock);
  run(gate, SPEECH, 300, clock);
  const duringPause = run(gate, QUIET_ROOM, 200, clock);
  check('a 200 ms pause does not cut the sentence', gate.isOpen, true);
  check('...and keeps transmitting through it', duringPause, 20);
  run(gate, QUIET_ROOM, 200, clock);
  check('a pause past the hold closes it', gate.isOpen, false);
}

// ── a noisy room ────────────────────────────────────────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  const sent = run(gate, NOISY_ROOM, 3000, clock);
  check('steady noise never opens the gate', sent, 0);
  check('...and raises the level a voice has to clear', gate.openThreshold > NOISY_ROOM, true);
  check('...but never above the threshold the speaking dot uses', gate.openThreshold <= SPEAKING_RMS_THRESHOLD, true);
  run(gate, SPEECH, 100, clock);
  check('...while a voice still opens it', gate.isOpen, true);
}

// ── a quiet talker in a quiet room ──────────────────────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  run(gate, QUIET_ROOM, 1000, clock);
  const soft = SPEAKING_RMS_THRESHOLD / 4;
  check('a quiet room lowers the bar for a quiet voice', gate.openThreshold < soft, true);
  run(gate, soft, 100, clock);
  check('...so a voice well under the fixed threshold is heard', gate.isOpen, true);
}

// ── the gate is never stricter than the dot ever was ────────────────────────
{
  const gate = new VoiceGate();
  const clock = { now: 0 };
  check('a gate that has heard nothing opens at the old threshold', gate.openThreshold, SPEAKING_RMS_THRESHOLD);
  run(gate, SPEAKING_RMS_THRESHOLD, 100, clock);
  check('...so a voice at that level opens it from the first frame', gate.isOpen, true);
}

finish();
