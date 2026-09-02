import { channelEnergy, clampInt16, FRAME_SIZE } from './constants.js';

/**
 * How the two captured channels become the stereo frame we send.
 *
 * - `stereo`: as captured.
 * - `mono`: average of both channels on both sides.
 * - `left` / `right`: that channel on both sides.
 * - `auto`: watch the first second of signal; if one channel is much louder than the
 *   other (a mic on input 1 of a stereo interface, the classic "only in my left ear"),
 *   use that channel alone; otherwise keep stereo.
 */
export const INPUT_CHANNEL_POLICIES = ['auto', 'stereo', 'mono', 'left', 'right'] as const;
export type InputChannelPolicy = (typeof INPUT_CHANNEL_POLICIES)[number];
export type ResolvedChannelPolicy = Exclude<InputChannelPolicy, 'auto'>;

export const INPUT_GAIN_DB_MIN = -30;
export const INPUT_GAIN_DB_MAX = 30;

/** Frames with a channel above this RMS count as signal for the auto decision. */
const SIGNAL_RMS = 200;
const SIGNAL_ENERGY = SIGNAL_RMS * SIGNAL_RMS * FRAME_SIZE;
/** Signal frames observed before deciding (100 = one second). */
const DECISION_FRAMES = 100;
/** Louder channel must exceed the other by this much to be treated as the only real one. */
const IMBALANCE_DB = 10;

/** `--input-channels` value → policy, or null when it is not one. */
export function parseChannelsFlag(value: string): InputChannelPolicy | null {
  return (INPUT_CHANNEL_POLICIES as readonly string[]).includes(value) ? (value as InputChannelPolicy) : null;
}

/** `--input-gain` value → dB, or null when it is not a number in range. */
export function parseGainFlag(value: string): number | null {
  const db = Number(value);
  return Number.isFinite(db) && db >= INPUT_GAIN_DB_MIN && db <= INPUT_GAIN_DB_MAX ? db : null;
}

/** Level difference between two RMS values in dB (always ≥ 0). */
export function imbalanceDb(a: number, b: number): number {
  return 20 * Math.log10((Math.max(a, b) + 1) / (Math.min(a, b) + 1));
}

export class InputConditioner {
  private readonly auto: boolean;
  private resolved: ResolvedChannelPolicy | null;
  private readonly gain: number;
  private sumL = 0;
  private sumR = 0;
  private signalFrames = 0;
  onDecision?: (policy: ResolvedChannelPolicy, detail: string) => void;

  constructor(policy: InputChannelPolicy = 'auto', gainDb = 0) {
    this.auto = policy === 'auto';
    this.resolved = policy === 'auto' ? null : policy;
    this.gain = 10 ** (gainDb / 20);
  }

  get current(): ResolvedChannelPolicy | null {
    return this.resolved;
  }

  /** Forget the auto decision (call when the capture device changes). */
  reset(): void {
    if (!this.auto) return;
    this.resolved = null;
    this.sumL = 0;
    this.sumR = 0;
    this.signalFrames = 0;
  }

  /** Condition one interleaved stereo frame in place. */
  process(frame: Int16Array): void {
    if (this.resolved === null) this.observe(frame);
    const g = this.gain;
    switch (this.resolved) {
      case 'left':
        for (let i = 0; i < frame.length; i += 2) frame[i + 1] = frame[i] = clampInt16(frame[i] * g);
        return;
      case 'right':
        for (let i = 0; i < frame.length; i += 2) frame[i] = frame[i + 1] = clampInt16(frame[i + 1] * g);
        return;
      case 'mono':
        for (let i = 0; i < frame.length; i += 2) {
          frame[i] = frame[i + 1] = clampInt16(((frame[i] + frame[i + 1]) >> 1) * g);
        }
        return;
      default:
        // stereo, or auto still undecided (pass-through until then)
        if (g !== 1) for (let i = 0; i < frame.length; i++) frame[i] = clampInt16(frame[i] * g);
    }
  }

  private observe(frame: Int16Array): void {
    const [l, r] = channelEnergy(frame);
    if (Math.max(l, r) < SIGNAL_ENERGY) return;
    this.sumL += Math.sqrt(l / FRAME_SIZE);
    this.sumR += Math.sqrt(r / FRAME_SIZE);
    if (++this.signalFrames < DECISION_FRAMES) return;

    const louder = this.sumL >= this.sumR ? 'left' : 'right';
    const db = imbalanceDb(this.sumL, this.sumR);
    this.resolved = db >= IMBALANCE_DB ? louder : 'stereo';
    this.onDecision?.(
      this.resolved,
      `L ${Math.round(this.sumL / DECISION_FRAMES)} / R ${Math.round(this.sumR / DECISION_FRAMES)} RMS, ${db.toFixed(1)} dB apart`,
    );
  }
}
