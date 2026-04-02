import type { WSMessage } from '@openmeet/shared';
import wrtc from '@roamhq/wrtc';
import { boostOpusQuality } from './sdp.js';

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = wrtc;

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

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
  private sendSignal: (message: WSMessage) => void;
  private myId: string;
  private onRemoteAudioTrack: (peerId: string, track: any) => void;
  private onRemoteVideoTrack: (peerId: string, track: any, streamType: 'webcam' | 'screen') => void;
  private onPeerDisconnected: (peerId: string) => void;
  private makingOffer = new Set<string>();
  private retryCount = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static MAX_RETRIES = 3;
  onDebug?: (msg: string) => void;

  constructor(options: {
    myId: string;
    audioTrack: any;
    videoTrack?: any;
    sendSignal: (msg: WSMessage) => void;
    onRemoteAudioTrack: (peerId: string, track: any) => void;
    onRemoteVideoTrack?: (peerId: string, track: any, streamType: 'webcam' | 'screen') => void;
    onPeerDisconnected: (peerId: string) => void;
    onDebug?: (msg: string) => void;
  }) {
    this.myId = options.myId;
    this.audioTrack = options.audioTrack;
    this.videoTrack = options.videoTrack ?? null;
    this.sendSignal = options.sendSignal;
    this.onRemoteAudioTrack = options.onRemoteAudioTrack;
    this.onRemoteVideoTrack = options.onRemoteVideoTrack ?? (() => {});
    this.onPeerDisconnected = options.onPeerDisconnected;
    this.onDebug = options.onDebug;
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
      }
      if (pc.connectionState === 'failed') {
        const existingTimer = this.retryTimers.get(peerId);
        if (existingTimer) clearTimeout(existingTimer);
        this.retryTimers.delete(peerId);
        this.connections.delete(peerId);
        this.makingOffer.delete(peerId);
        this.onPeerDisconnected(peerId);
        this.scheduleRetry(peerId);
      }
    };

    return pc;
  }

  /** Create a peer connection WITH 3 transceivers (offerer path). */
  private createOffererConnection(peerId: string): any {
    const pc = this.setupPeerConnection(peerId);

    // Transceiver 0: Audio — sendrecv, high priority (attach our audio track)
    pc.addTransceiver('audio', {
      direction: 'sendrecv',
      sendEncodings: [{ priority: 'high', networkPriority: 'high' }],
    });
    if (this.audioTrack) {
      pc.getTransceivers()[0].sender.replaceTrack(this.audioTrack);
    }

    // Transceiver 1: Webcam video — sendrecv (attach our video track if available)
    pc.addTransceiver('video', {
      direction: 'sendrecv',
      sendEncodings: [{ priority: 'low', networkPriority: 'low', maxFramerate: 30 }],
    });
    if (this.videoTrack) {
      pc.getTransceivers()[1].sender.replaceTrack(this.videoTrack);
    }

    // Transceiver 2: Screen share video — recvonly (terminal never shares screen)
    pc.addTransceiver('video', {
      direction: 'recvonly',
    });

    return pc;
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
        sdp: boostOpusQuality(offer.sdp ?? ''),
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
    // Uses the same lexicographic ID comparison as the web client so both
    // sides agree on who yields and who ignores.
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
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

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

      // Screen video (index 2): always recvonly for terminal (no change needed)

      const answer = await pc.createAnswer();
      const modifiedSdp = boostOpusQuality(answer.sdp ?? '');

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
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.onDebug?.(`RTC answer applied for ${peerId.slice(0, 6)}`);
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
