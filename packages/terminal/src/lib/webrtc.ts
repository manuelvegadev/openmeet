import type { WSMessage } from '@openmeet/shared';
import wrtc from '@roamhq/wrtc';
import {
  BANDWIDTH_AUDIO_ALLOWANCE_KBPS,
  boostOpusQuality,
  capOutgoingAudioBitrate,
  DEFAULT_AUDIO_KBPS,
  DEFAULT_SCREEN_KBPS,
  forceScreenSendrecv,
  pixelFactor,
  preferAudioRed,
  setScreenBandwidth,
} from './sdp.js';

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

const SCREEN_MIN_BITRATE = 800_000;
/** Mesh sends one copy per peer, so the ceiling is a share of this, not the whole link. */
const MESH_UPLINK_BUDGET = 6_000_000;

/**
 * Screen-share ceiling in bps for a room where we send to `receiverCount` peers, under the
 * user's `screenSendKbps`. The mesh budget is split per receiver; the floor keeps a full
 * room legible rather than fair.
 */
export function screenBitrateFor(receiverCount: number, screenSendKbps: number): number {
  const share = MESH_UPLINK_BUDGET / Math.max(1, receiverCount);
  return Math.round(Math.min(screenSendKbps * 1000, Math.max(SCREEN_MIN_BITRATE, share)));
}

/**
 * The send policy, by transceiver index, and what @roamhq/wrtc actually does with it.
 *
 * Of the encoding fields only `priority` (the bitrate allocator's share), `maxBitrate` and
 * `degradationPreference` survive; `networkPriority` and `maxFramerate` are dropped silently
 * — they never come back from `getParameters()`. `networkPriority` would be a no-op anyway:
 * libwebrtc leaves DSCP marking off by default, and Windows ignores `setsockopt(IP_TOS)`
 * unless a machine-wide QoS policy is installed.
 *
 * All of it has to be applied before `setLocalDescription`. Once a sender has an SSRC,
 * `setParameters` fails with "Attempted to set RtpParameters with modified SSRC", because the
 * binding's `getParameters()` does not expose the per-encoding ssrc to round-trip. A running
 * connection therefore keeps the ceiling it was created with until it renegotiates.
 *
 * Only the offerer can apply any of it. It carries the encodings through `addTransceiver`
 * and sets `degradationPreference` right after. The answerer cannot: its senders come from
 * `addTrack` and `setRemoteDescription`, and before negotiation `getParameters()` reports
 * `encodings: []` — adding one is refused with "Attempted to set RtpParameters with
 * different encoding count", and after negotiation the ssrc check refuses everything. So an
 * answerer's audio keeps the allocator's default share and its screen share is uncapped
 * until it becomes the offerer of a renegotiation. Nothing here can change that.
 */
function sendPolicy(
  receiverCount: number,
  screenSendKbps: number,
): { encoding: Record<string, unknown>; degradation?: string }[] {
  return [
    { encoding: { priority: 'high' } }, // audio: first claim on the allocator
    { encoding: { priority: 'low' } }, // webcam
    // Screen: shed frames before pixels — a blurry screen is unreadable, a jerky one is not.
    {
      encoding: { priority: 'low', maxBitrate: screenBitrateFor(receiverCount, screenSendKbps) },
      degradation: 'maintain-resolution',
    },
  ];
}

/**
 * Apply what `addTransceiver` could not carry. Reports rather than swallows — a refused cap
 * is worth knowing about, and a silent catch here hid the answerer problem above for a while.
 *
 * Never trust what `getParameters()` hands back (gotcha 33): on the Windows prebuild the
 * `maxBitrate` it returns right after `addTransceiver` is uninitialised memory — a denormal
 * like 4.3e-312 some of the time, the real value other times — and writing that back through
 * `setParameters()` lands as a ceiling of 0 bps, after which the encoder never produces a
 * frame. `priority` does not come back at all, on any platform. So the intended encoding is
 * merged over the read-back, field by field, and the read-back only supplies what we never set.
 */
async function applySendParameters(
  sender: any,
  encoding: Record<string, unknown>,
  degradationPreference: string,
  onDebug?: (msg: string) => void,
): Promise<void> {
  try {
    const params = sender.getParameters();
    // Never add or remove an encoding: libwebrtc refuses a changed count outright.
    if (!params.encodings?.length) {
      onDebug?.(`RTC setParameters skipped (${degradationPreference}): no encodings yet`);
      return;
    }
    onDebug?.(`RTC encodings read back: ${JSON.stringify(params.encodings)}`);
    // Only the count is taken from the read-back: every value in it is suspect (gotcha 33).
    params.encodings = params.encodings.map(() => ({ ...encoding, active: true }));
    params.degradationPreference = degradationPreference;
    await sender.setParameters(params);
    onDebug?.(`RTC encodings applied: ${JSON.stringify(sender.getParameters().encodings)} ${degradationPreference}`);
  } catch (err) {
    onDebug?.(`RTC setParameters refused (${degradationPreference}): ${err}`);
  }
}

/** One line of a sender's live parameters, for the debug log. */
function describeSender(sender: any): string {
  try {
    const p = sender.getParameters();
    return `encodings ${JSON.stringify(p.encodings)} degradation ${p.degradationPreference ?? '-'} track ${sender.track ? sender.track.kind + (sender.track.enabled ? '' : '(disabled)') : 'none'}`;
  } catch (err) {
    return `getParameters failed: ${err}`;
  }
}

export function createAudioSource(): { source: any; track: any } {
  const { RTCAudioSource } = wrtc.nonstandard;
  const source = new RTCAudioSource();
  const track = source.createTrack();
  return { source, track };
}

export class PeerConnectionManager {
  private connections = new Map<string, any>();
  private audioTrack: any;
  private videoTrack: any;
  private screenTrack: any = null;
  private sendSignal: (message: WSMessage) => void;
  private myId: string;
  private onRemoteAudioTrack: (peerId: string, track: any) => void;
  private onRemoteVideoTrack: (peerId: string, track: any, streamType: 'webcam' | 'screen') => void;
  private onPeerDisconnected: (peerId: string) => void;
  private makingOffer = new Set<string>();
  private pendingRenegotiation = new Set<string>();
  private retryCount = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static MAX_RETRIES = 3;
  private audioSendKbps = DEFAULT_AUDIO_KBPS;
  private audioReceiveKbps = DEFAULT_AUDIO_KBPS;
  private screenSendKbps = DEFAULT_SCREEN_KBPS;
  private screenReceiveKbps = DEFAULT_SCREEN_KBPS;
  /** The shape the current share goes out at; null when not sharing. Feeds `pixelFactor`. */
  private screenShape: { width: number; height: number } | null = null;
  /** How many connections the current share's budgets were computed for; see `refreshBudgets`. */
  private budgetedCount = 0;
  onDebug?: (msg: string) => void;

  constructor(options: {
    myId: string;
    audioTrack: any;
    videoTrack?: any;
    screenTrack?: any;
    sendSignal: (msg: WSMessage) => void;
    onRemoteAudioTrack: (peerId: string, track: any) => void;
    onRemoteVideoTrack?: (peerId: string, track: any, streamType: 'webcam' | 'screen') => void;
    onPeerDisconnected: (peerId: string) => void;
    onDebug?: (msg: string) => void;
    /** Opus ceilings in kbps. Send is applied to the peer's description, receive to ours. */
    audioSendKbps?: number;
    audioReceiveKbps?: number;
    /** Screen-share ceilings in kbps, same two places (see `setScreenBandwidth`). */
    screenSendKbps?: number;
    screenReceiveKbps?: number;
  }) {
    this.myId = options.myId;
    this.audioTrack = options.audioTrack;
    this.videoTrack = options.videoTrack ?? null;
    this.screenTrack = options.screenTrack ?? null;
    this.sendSignal = options.sendSignal;
    this.onRemoteAudioTrack = options.onRemoteAudioTrack;
    this.onRemoteVideoTrack = options.onRemoteVideoTrack ?? (() => {});
    this.onPeerDisconnected = options.onPeerDisconnected;
    this.audioSendKbps = options.audioSendKbps ?? DEFAULT_AUDIO_KBPS;
    this.audioReceiveKbps = options.audioReceiveKbps ?? DEFAULT_AUDIO_KBPS;
    this.screenSendKbps = options.screenSendKbps ?? DEFAULT_SCREEN_KBPS;
    this.screenReceiveKbps = options.screenReceiveKbps ?? DEFAULT_SCREEN_KBPS;
    this.onDebug = options.onDebug;
  }

  /**
   * What we will send this peer at most, in kbps, as of now: the user's screen ceiling for
   * the current share's shape, split across the peers we send to, plus room for audio. This
   * is what goes into every description the peer hands us, so it follows the room and the
   * share instead of being frozen at connection time like the encoding's `maxBitrate`.
   */
  private sendBudgetKbps(): number {
    const video = screenBitrateFor(this.connections.size, this.screenSendKbps) / 1000;
    const factor = pixelFactor(this.screenShape?.width, this.screenShape?.height);
    return Math.round(video * factor) + BANDWIDTH_AUDIO_ALLOWANCE_KBPS;
  }

  setMyId(id: string): void {
    this.myId = id;
  }

  /** Create a bare peer connection with event handlers but NO transceivers. */
  private setupPeerConnection(peerId: string): any {
    if (this.connections.has(peerId)) {
      this.connections.get(peerId).close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.connections.set(peerId, pc);

    pc.ontrack = (event: any) => {
      if (event.track.kind === 'audio') {
        this.onRemoteAudioTrack(peerId, event.track);
      } else if (event.track.kind === 'video') {
        // Determine webcam vs screen by transceiver index: 1 = webcam, 2 = screen
        const transceivers = pc.getTransceivers();
        const idx = transceivers.indexOf(event.transceiver);
        const streamType = idx === 2 ? 'screen' : 'webcam';
        this.onDebug?.(`RTC video track from ${peerId.slice(0, 6)}: ${streamType} (transceiver ${idx})`);
        this.onRemoteVideoTrack(peerId, event.track, streamType);
      }
    };

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        this.onDebug?.(`RTC ICE candidate for ${peerId.slice(0, 6)}: ${event.candidate.candidate?.slice(0, 40)}`);
        this.sendSignal({
          type: 'ice-candidate',
          fromId: this.myId,
          toId: peerId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      this.onDebug?.(`RTC ${peerId.slice(0, 6)} state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.retryCount.delete(peerId);
        // Only now: re-offering the others while this peer's first offer is in flight would
        // be glare, and its own budget was already computed with it in the map.
        this.refreshBudgets(peerId);
      }
      if (pc.connectionState === 'failed') {
        const existingTimer = this.retryTimers.get(peerId);
        if (existingTimer) clearTimeout(existingTimer);
        this.retryTimers.delete(peerId);
        this.connections.delete(peerId);
        this.makingOffer.delete(peerId);
        this.onPeerDisconnected(peerId);
        this.scheduleRetry(peerId);
        this.refreshBudgets();
      }
    };

    return pc;
  }

  /**
   * Create a peer connection WITH 3 transceivers (offerer path).
   *
   * The order is the contract both sides rely on: audio, webcam, screen. `sendEncodings`
   * carries most of the send policy; `degradationPreference` is the one field
   * `addTransceiver` cannot express, so it goes in straight after.
   */
  private createOffererConnection(peerId: string): any {
    const pc = this.setupPeerConnection(peerId);
    const policy = sendPolicy(this.connections.size, this.screenSendKbps);
    const tracks = [this.audioTrack, this.videoTrack, this.screenTrack];

    for (const [index, { encoding }] of policy.entries()) {
      const track = tracks[index];
      pc.addTransceiver(index === 0 ? 'audio' : 'video', {
        // Only the screen transceiver goes recvonly when idle; audio stays sendrecv so
        // `ontrack` fires on the far side even with no track (see gotcha 2).
        direction: index === 2 && !track ? 'recvonly' : 'sendrecv',
        sendEncodings: [encoding],
      });
      const { sender } = pc.getTransceivers()[index];
      if (track) sender.replaceTrack(track);
      const { degradation } = policy[index];
      if (degradation) void applySendParameters(sender, encoding, degradation, this.onDebug);
    }

    return pc;
  }

  /** Everything we hand to `setLocalDescription`: what we send, and our receive ceilings. */
  private localSdp(sdp: string): string {
    const audio = boostOpusQuality(preferAudioRed(sdp), this.audioReceiveKbps);
    return setScreenBandwidth(audio, this.screenReceiveKbps + BANDWIDTH_AUDIO_ALLOWANCE_KBPS);
  }

  /** Everything we hand to `setRemoteDescription`: the peer's line, bounded by our send ceilings. */
  private remoteSdp(sdp: any, peerId: string): any {
    if (typeof sdp?.sdp !== 'string') return sdp;
    const budget = this.sendBudgetKbps();
    if (this.screenTrack) this.onDebug?.(`RTC send budget to ${peerId.slice(0, 6)}: ${budget} kbps`);
    const audio = capOutgoingAudioBitrate(sdp.sdp, this.audioSendKbps);
    return { ...sdp, sdp: setScreenBandwidth(audio, budget) };
  }

  /** Extract a plain { type, sdp } object for safe JSON serialization. */
  private static extractSdp(desc: any): any {
    return { type: desc.type, sdp: desc.sdp };
  }

  async createConnection(peerId: string): Promise<void> {
    this.makingOffer.add(peerId);
    try {
      const pc = this.createOffererConnection(peerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        ...offer,
        sdp: this.localSdp(offer.sdp ?? ''),
      });

      this.onDebug?.(`RTC offer created for ${peerId.slice(0, 6)}`);
      this.sendSignal({
        type: 'offer',
        fromId: this.myId,
        toId: peerId,
        sdp: PeerConnectionManager.extractSdp(pc.localDescription),
      });
    } catch (err) {
      this.onDebug?.(`RTC offer creation failed for ${peerId.slice(0, 6)}: ${err}`);
    } finally {
      this.makingOffer.delete(peerId);
    }
  }

  async handleOffer(peerId: string, sdp: any): Promise<void> {
    let pc = this.connections.get(peerId);

    // Perfect negotiation — detect offer collision (glare).
    // Lexicographic ID comparison so both sides agree on who yields and who ignores.
    const offerCollision = this.makingOffer.has(peerId) || (pc && pc.signalingState !== 'stable');
    const polite = this.myId < peerId;

    if (!polite && offerCollision) {
      // Impolite: ignore incoming offer — remote (polite) will process ours
      this.onDebug?.(`RTC glare: impolite, ignoring offer from ${peerId.slice(0, 6)}`);
      return;
    }

    if (offerCollision && pc) {
      // Polite: yield by closing our offerer and recreating as answerer.
      // Can't use setLocalDescription({ type: 'rollback' }) in @roamhq/wrtc,
      // so close+recreate is the equivalent. addTransceiver-created transceivers
      // aren't eligible for m-line matching, so reuse isn't possible anyway.
      this.onDebug?.(`RTC glare: polite, yielding to ${peerId.slice(0, 6)}`);
      pc.close();
      this.connections.delete(peerId);
      pc = undefined;
    }

    if (!pc) {
      // Answerer path: use addTrack (NOT addTransceiver) to pre-attach audio.
      // Per the WebRTC spec, only addTrack-created transceivers are eligible
      // for m-line matching during setRemoteDescription. addTransceiver-created
      // ones are NOT matched, causing duplicate transceivers.
      //
      // addTrack creates a sendrecv transceiver with our track attached.
      // setRemoteDescription matches it to the offer's audio m-line and
      // creates new transceivers for the 2 video m-lines → 3 total.
      pc = this.setupPeerConnection(peerId);
      if (this.audioTrack) {
        pc.addTrack(this.audioTrack);
      }
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(this.remoteSdp(sdp, peerId)));

      // Set transceiver directions BEFORE createAnswer so the answer SDP
      // reflects the correct state natively (no post-creation SDP munging).
      const transceivers = pc.getTransceivers();

      // Audio (index 0): must be sendrecv to send our audio
      if (transceivers.length > 0) {
        transceivers[0].direction = 'sendrecv';
        if (this.audioTrack) {
          transceivers[0].sender.replaceTrack(this.audioTrack);
        }
      }

      // Webcam video (index 1): sendrecv if we have video, leave as-is otherwise
      if (transceivers.length > 1 && this.videoTrack) {
        transceivers[1].sender.replaceTrack(this.videoTrack);
        transceivers[1].direction = 'sendrecv';
      }

      // Screen video (index 2): sendrecv if we have a screen track, recvonly otherwise
      if (transceivers.length > 2 && this.screenTrack) {
        transceivers[2].sender.replaceTrack(this.screenTrack);
        transceivers[2].direction = 'sendrecv';
      }

      const answer = await pc.createAnswer();
      const modifiedSdp = this.localSdp(answer.sdp ?? '');

      // Verify directions are correct (diagnostic only, no munging)
      if (this.onDebug) {
        const sections = modifiedSdp.split(/(?=m=)/);
        const audioSection = sections.find((s: string) => s.startsWith('m=audio'));
        if (audioSection && !audioSection.includes('a=sendrecv')) {
          this.onDebug(`WARNING: audio answer SDP is not sendrecv — audio may not be sent`);
        }
      }

      await pc.setLocalDescription({ ...answer, sdp: modifiedSdp });

      this.onDebug?.(`RTC answer created for ${peerId.slice(0, 6)}`);
      this.sendSignal({
        type: 'answer',
        fromId: this.myId,
        toId: peerId,
        sdp: PeerConnectionManager.extractSdp(pc.localDescription),
      });
    } catch (err) {
      this.onDebug?.(`RTC handleOffer from ${peerId.slice(0, 6)} failed: ${err}`);
    }
  }

  async handleAnswer(peerId: string, sdp: any): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(this.remoteSdp(sdp, peerId)));
      // Log transceiver states after answer is applied
      const transceivers = pc.getTransceivers();
      const dirs = transceivers.map((t: any, i: number) => `t${i}:${t.direction}/${t.currentDirection ?? '?'}`);
      this.onDebug?.(`RTC answer applied for ${peerId.slice(0, 6)} [${dirs.join(', ')}]`);
      if (this.screenTrack && transceivers[2]) {
        this.onDebug?.(
          `RTC screen sender for ${peerId.slice(0, 6)} after answer: ${describeSender(transceivers[2].sender)}`,
        );
      }
    } catch (err) {
      this.onDebug?.(`RTC handleAnswer from ${peerId.slice(0, 6)} failed: ${err}`);
    }
  }

  async handleIceCandidate(peerId: string, candidate: any): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      this.onDebug?.(`RTC ICE for ${peerId.slice(0, 6)}: ${err}`);
    }
  }

  /** Replace the video track on all existing peer connections. */
  setVideoTrack(track: any | null): void {
    this.videoTrack = track;
    for (const [, pc] of this.connections) {
      const transceivers = pc.getTransceivers();
      if (transceivers.length > 1) {
        try {
          transceivers[1].sender.replaceTrack(track);
        } catch {
          // Connection may have closed
        }
      }
    }
  }

  /**
   * Set/clear the screen share track on transceiver 2. Triggers renegotiation on direction
   * change. `shape` is what the share goes out at, for the bandwidth budget.
   */
  setScreenTrack(track: any | null, shape?: { width: number; height: number }): void {
    this.screenTrack = track;
    this.screenShape = shape ?? null;
    // The renegotiation below carries the budget to every peer we have right now.
    this.budgetedCount = this.connections.size;
    for (const [peerId, pc] of this.connections) {
      const transceivers = pc.getTransceivers();
      if (transceivers.length > 2) {
        try {
          transceivers[2].sender.replaceTrack(track);
          const wantedDir = track ? 'sendrecv' : 'recvonly';
          this.onDebug?.(
            `RTC screen transceiver for ${peerId.slice(0, 6)}: ${transceivers[2].direction} → ${wantedDir}`,
          );
          if (transceivers[2].direction !== wantedDir) {
            transceivers[2].direction = wantedDir;
            this.renegotiate(peerId, pc);
          }
        } catch (err) {
          this.onDebug?.(`RTC setScreenTrack for ${peerId.slice(0, 6)} failed: ${err}`);
        }
      }
    }
  }

  private async renegotiate(peerId: string, pc: any): Promise<void> {
    if (this.makingOffer.has(peerId)) {
      this.pendingRenegotiation.add(peerId);
      return;
    }
    this.makingOffer.add(peerId);
    try {
      const offer = await pc.createOffer();
      let sdp = this.localSdp(offer.sdp ?? '');

      if (this.screenTrack) {
        const forced = forceScreenSendrecv(sdp);
        if (forced !== sdp) this.onDebug?.(`RTC forced screen m-line to sendrecv for ${peerId.slice(0, 6)}`);
        sdp = forced;
      }

      await pc.setLocalDescription({ ...offer, sdp });
      this.onDebug?.(`RTC renegotiation offer for ${peerId.slice(0, 6)}`);
      this.sendSignal({
        type: 'offer',
        fromId: this.myId,
        toId: peerId,
        sdp: PeerConnectionManager.extractSdp(pc.localDescription),
      });
    } catch (err) {
      this.onDebug?.(`RTC renegotiation with ${peerId.slice(0, 6)} failed: ${err}`);
    } finally {
      this.makingOffer.delete(peerId);
      this.flushPendingRenegotiation(peerId);
    }
  }

  /**
   * The send budget in `remoteSdp` is a share of the uplink per peer, so while a share is
   * running every change in how many peers we send to re-offers the others — owned here,
   * next to the map it depends on, rather than by room events that fire before the newcomer
   * has a connection. `except` is the peer whose own negotiation just carried its budget.
   */
  private refreshBudgets(except?: string): void {
    if (!this.screenTrack || this.connections.size === this.budgetedCount) return;
    this.budgetedCount = this.connections.size;
    for (const [peerId, pc] of this.connections) {
      if (peerId !== except) void this.renegotiate(peerId, pc);
    }
  }

  private flushPendingRenegotiation(peerId: string): void {
    if (this.pendingRenegotiation.has(peerId)) {
      this.pendingRenegotiation.delete(peerId);
      const pc = this.connections.get(peerId);
      if (pc) this.renegotiate(peerId, pc);
    }
  }

  /** Schedule a retry for a failed connection (only impolite peer retries). */
  private scheduleRetry(peerId: string): void {
    // Only the "impolite" peer (larger ID) retries to avoid simultaneous attempts
    if (this.myId < peerId) return;

    const count = this.retryCount.get(peerId) ?? 0;
    if (count >= PeerConnectionManager.MAX_RETRIES) {
      this.onDebug?.(`RTC max retries reached for ${peerId.slice(0, 6)}`);
      this.retryCount.delete(peerId);
      return;
    }

    const delay = 1000 * 2 ** count;
    this.retryCount.set(peerId, count + 1);
    this.onDebug?.(
      `RTC retry ${count + 1}/${PeerConnectionManager.MAX_RETRIES} for ${peerId.slice(0, 6)} in ${delay}ms`,
    );

    const timer = setTimeout(() => {
      this.retryTimers.delete(peerId);
      this.createConnection(peerId);
    }, delay);
    this.retryTimers.set(peerId, timer);
  }

  removeConnection(peerId: string): void {
    const timer = this.retryTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(peerId);
    }
    this.retryCount.delete(peerId);
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
      this.makingOffer.delete(peerId);
      this.onPeerDisconnected(peerId);
      this.refreshBudgets();
    }
  }

  closeAll(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCount.clear();
    for (const peerId of [...this.connections.keys()]) {
      this.removeConnection(peerId);
    }
  }

  getConnection(peerId: string): any | undefined {
    return this.connections.get(peerId);
  }

  getAllPeerIds(): string[] {
    return [...this.connections.keys()];
  }
}
