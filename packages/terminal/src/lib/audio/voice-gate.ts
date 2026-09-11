import { FRAME_SAMPLES, SPEAKING_RMS_THRESHOLD } from './constants.js';

/**
 * The voice gate: what decides whether we are on the air.
 *
 * A call is mostly silence, and in a mesh silence costs exactly what speech costs — our
 * encoder runs, a packet goes to every peer, and every peer's jitter buffer and decoder run
 * to turn it back into nothing. Gating the capture path stops all of it at the source: while
 * the gate is shut nothing reaches WebRTC, so nothing is encoded here, sent, or decoded
 * anywhere in the room. The speaking dot is this gate — the dot says "you are being heard",
 * which is the one thing about your own microphone worth a cell of the screen.
 *
 * Two things make a gate safe to put in front of a microphone:
 *
 * - **It listens to the room.** A fixed threshold either cuts a quiet talker or opens on a
 *   fan. The floor is measured only while the gate is shut — measuring during speech would
 *   let the gate raise its own bar until it never opened — and it falls fast and rises
 *   slowly. The opening level sits about 10 dB above it, never above
 *   `SPEAKING_RMS_THRESHOLD`, so the gate is never stricter than the threshold the speaking
 *   dot has always used, and never below `MIN_OPEN_RMS`, so digital silence cannot open it.
 * - **It keeps the attack.** The gate opens on the frame that crosses the threshold, but the
 *   consonant that started the word is already a few frames old. Those frames wait in a ring
 *   behind the gate and go out ahead of it, so nothing is clipped off the front of a word.
 *
 * Closing is the mirror: it stays open well below the level that opened it, and then for a
 * hold after that, so the pause between two words is not a hole in the sentence.
 */

/** Frames of attack kept behind a shut gate: 40 ms, about one consonant. */
const PREBUFFER_FRAMES = 4;
/** How long the gate stays open after the level drops — the same hold the dot has always had. */
const HOLD_MS = 300;
/** The opening level, over the measured floor: ×3 is about 10 dB. */
const OPEN_OVER_FLOOR = 3;
/** Hysteresis: it takes half the opening level to keep it open. */
const CLOSE_FRACTION = 0.5;
/** Below this the room is silent, whatever the floor says (~-48 dBFS). */
const MIN_OPEN_RMS = 120;
/** Capping the floor is what keeps the opening level at or under the dot's own threshold. */
const FLOOR_MAX = SPEAKING_RMS_THRESHOLD / OPEN_OVER_FLOOR;
/** Per frame, toward a quieter measurement: 63% of the way in ten frames. */
const FLOOR_FALL = 0.1;
/** Per frame, while the room is louder than the floor: about +0.17 dB per second. */
const FLOOR_RISE = 1.0002;

export class VoiceGate {
  private floor = FLOOR_MAX;
  private open = false;
  private holdUntil = 0;
  /** The attack ring: preallocated, written in place, never resized. */
  private readonly ring = Array.from({ length: PREBUFFER_FRAMES }, () => new Int16Array(FRAME_SAMPLES));
  private ringHead = 0;
  private ringCount = 0;
  /** Reused: `step` fills it and the caller consumes it before the next frame. */
  private readonly out: Int16Array[] = [];

  /** True while we are transmitting — which is what the speaking dot shows. */
  get isOpen(): boolean {
    return this.open;
  }

  /** The RMS that would open the gate right now: the measured floor plus its margin. */
  get openThreshold(): number {
    return Math.min(Math.max(this.floor * OPEN_OVER_FLOOR, MIN_OPEN_RMS), SPEAKING_RMS_THRESHOLD);
  }

  /**
   * Shut the gate without forgetting the room: what muting does. Feeding the gate silence
   * instead would teach it that the room has no noise floor, and it would come back from a
   * long mute opening on the first cough.
   */
  close(): void {
    this.open = false;
    this.holdUntil = 0;
    this.ringCount = 0;
  }

  /** A new device is a new room: forget the floor and whatever was waiting in the ring. */
  reset(): void {
    this.floor = FLOOR_MAX;
    this.open = false;
    this.holdUntil = 0;
    this.ringHead = 0;
    this.ringCount = 0;
  }

  /**
   * Feed one capture frame. Returns the frames to transmit, oldest first: nothing while the
   * gate is shut, the buffered attack and this frame on the edge that opens it, this frame
   * alone while it stays open. The array and the buffered frames are reused — push them to
   * WebRTC (which copies) before calling again.
   */
  step(frame: Int16Array, rms: number, now: number): readonly Int16Array[] {
    this.out.length = 0;
    const openAt = this.openThreshold;

    if (!this.open) {
      this.floor =
        rms < this.floor ? this.floor + (rms - this.floor) * FLOOR_FALL : Math.min(this.floor * FLOOR_RISE, FLOOR_MAX);
      if (rms < openAt) {
        this.remember(frame);
        return this.out;
      }
      this.open = true;
      this.holdUntil = now + HOLD_MS;
      for (let i = 0; i < this.ringCount; i++) {
        this.out.push(this.ring[(this.ringHead - this.ringCount + i + this.ring.length) % this.ring.length]);
      }
      this.ringCount = 0;
      this.out.push(frame);
      return this.out;
    }

    if (rms >= openAt * CLOSE_FRACTION) this.holdUntil = now + HOLD_MS;
    else if (now >= this.holdUntil) {
      this.open = false;
      this.remember(frame);
      return this.out;
    }
    this.out.push(frame);
    return this.out;
  }

  private remember(frame: Int16Array): void {
    this.ring[this.ringHead].set(frame);
    this.ringHead = (this.ringHead + 1) % this.ring.length;
    if (this.ringCount < this.ring.length) this.ringCount++;
  }
}
