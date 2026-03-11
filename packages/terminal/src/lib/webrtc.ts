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
  private sendSignal: (message: WSMessage) => void;
  private myId: string;
  private onRemoteAudioTrack: (peerId: string, track: any) => void;
  private onPeerDisconnected: (peerId: string) => void;
  private makingOffer = new Set<string>();

  constructor(options: {
    myId: string;
    audioTrack: any;
    sendSignal: (msg: WSMessage) => void;
    onRemoteAudioTrack: (peerId: string, track: any) => void;
    onPeerDisconnected: (peerId: string) => void;
  }) {
    this.myId = options.myId;
    this.audioTrack = options.audioTrack;
    this.sendSignal = options.sendSignal;
    this.onRemoteAudioTrack = options.onRemoteAudioTrack;
    this.onPeerDisconnected = options.onPeerDisconnected;
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
      }
    };

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice-candidate',
          fromId: this.myId,
          toId: peerId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.removeConnection(peerId);
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

    // Transceiver 1: Webcam video — sendrecv (for SDP m-line compatibility, no track)
    pc.addTransceiver('video', {
      direction: 'sendrecv',
      sendEncodings: [{ priority: 'low', networkPriority: 'low', maxFramerate: 30 }],
    });

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
    try {
      const pc = this.createOffererConnection(peerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription({
        ...offer,
        sdp: boostOpusQuality(offer.sdp ?? ''),
      });

      this.sendSignal({
        type: 'offer',
        fromId: this.myId,
        toId: peerId,
        sdp: PeerConnectionManager.extractSdp(pc.localDescription),
      });
    } catch {
      // Offer creation failed — non-fatal, peer will retry
    }
  }

  async handleOffer(peerId: string, sdp: any): Promise<void> {
    let pc = this.connections.get(peerId);

    if (pc && pc.signalingState === 'have-local-offer') {
      // Glare: both sides sent offers simultaneously. Close our offerer
      // connection and recreate as answerer. We can't rollback and reuse
      // because addTransceiver-created transceivers aren't eligible for
      // m-line matching during setRemoteDescription (spec behavior).
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

      const answer = await pc.createAnswer();
      let modifiedSdp = answer.sdp ?? '';

      // Safety net: if @roamhq/wrtc generated recvonly for audio despite our
      // sendrecv transceiver, munge the SDP so the browser knows we send audio.
      const mSections = modifiedSdp.split(/(?=m=)/);
      const audioIdx = mSections.findIndex((s: string) => s.startsWith('m=audio'));
      if (audioIdx >= 0 && !mSections[audioIdx].includes('a=sendrecv')) {
        mSections[audioIdx] = mSections[audioIdx].replace(/a=recvonly|a=inactive/, 'a=sendrecv');
        modifiedSdp = mSections.join('');
      }

      modifiedSdp = boostOpusQuality(modifiedSdp);
      await pc.setLocalDescription({ ...answer, sdp: modifiedSdp });

      this.sendSignal({
        type: 'answer',
        fromId: this.myId,
        toId: peerId,
        sdp: PeerConnectionManager.extractSdp(pc.localDescription),
      });
    } catch {
      // Offer handling failed — non-fatal
    }
  }

  async handleAnswer(peerId: string, sdp: any): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch {
      // Answer handling failed — non-fatal
    }
  }

  async handleIceCandidate(peerId: string, candidate: any): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ICE candidate errors are common and non-fatal (late candidates after connection)
    }
  }

  removeConnection(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
      this.makingOffer.delete(peerId);
      this.onPeerDisconnected(peerId);
    }
  }

  closeAll(): void {
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
