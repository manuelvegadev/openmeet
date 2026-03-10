import type { WSMessage } from '@openmeet/shared';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

function enableStereoOpus(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) (.+)/g, (match, pt, params) => {
    if (params.includes('minptime')) {
      if (!params.includes('stereo=1')) {
        return `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1`;
      }
    }
    return match;
  });
}

export class PeerConnectionManager {
  private connections = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private sendSignal: (message: WSMessage) => void;
  private myId: string;
  private onRemoteStream: (peerId: string, stream: MediaStream) => void;
  private onRemoteStreamRemoved: (peerId: string) => void;
  private makingOffer = new Set<string>();

  constructor(options: {
    myId: string;
    sendSignal: (msg: WSMessage) => void;
    onRemoteStream: (peerId: string, stream: MediaStream) => void;
    onRemoteStreamRemoved: (peerId: string) => void;
  }) {
    this.myId = options.myId;
    this.sendSignal = options.sendSignal;
    this.onRemoteStream = options.onRemoteStream;
    this.onRemoteStreamRemoved = options.onRemoteStreamRemoved;
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const [peerId, pc] of this.connections) {
      let needsRenegotiation = false;

      for (const track of stream.getTracks()) {
        // Find an existing sender already sending this kind
        const existingSender = pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (existingSender) {
          existingSender.replaceTrack(track);
          continue;
        }

        // Find a recvonly transceiver placeholder for this kind and upgrade it
        const transceiver = pc.getTransceivers().find((t) => t.receiver.track?.kind === track.kind && !t.sender.track);
        if (transceiver) {
          transceiver.sender.replaceTrack(track);
          transceiver.direction = 'sendrecv';
          needsRenegotiation = true;
          continue;
        }

        // Fallback: add new track (creates new transceiver)
        pc.addTrack(track, stream);
        needsRenegotiation = true;
      }

      if (needsRenegotiation) {
        this.renegotiate(peerId, pc);
      }
    }
  }

  replaceVideoTrack(newTrack: MediaStreamTrack): void {
    for (const [, pc] of this.connections) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(newTrack);
      }
    }
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        this.replaceVideoTrack(videoTrack);
      }
    } else if (this.localStream) {
      const webcamTrack = this.localStream.getVideoTracks()[0];
      if (webcamTrack) {
        this.replaceVideoTrack(webcamTrack);
      }
    }
  }

  async createConnection(peerId: string): Promise<void> {
    const pc = this.createPeerConnection(peerId);

    const offer = await pc.createOffer();
    const modifiedSdp = enableStereoOpus(offer.sdp ?? '');
    await pc.setLocalDescription({ ...offer, sdp: modifiedSdp });

    this.sendSignal({
      type: 'offer',
      fromId: this.myId,
      toId: peerId,
      sdp: pc.localDescription!,
    });
  }

  async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    let pc = this.connections.get(peerId);
    if (!pc) {
      pc = this.createPeerConnection(peerId);
    }

    try {
      // Handle glare: if we also sent an offer, rollback ours (be polite)
      if (pc.signalingState === 'have-local-offer') {
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      const modifiedSdp = enableStereoOpus(answer.sdp ?? '');
      await pc.setLocalDescription({ ...answer, sdp: modifiedSdp });

      this.sendSignal({
        type: 'answer',
        fromId: this.myId,
        toId: peerId,
        sdp: pc.localDescription!,
      });
    } catch (err) {
      console.error(`handleOffer from ${peerId} failed:`, err);
    }
  }

  async handleAnswer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error(`handleAnswer from ${peerId} failed:`, err);
    }
  }

  async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.connections.get(peerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`handleIceCandidate from ${peerId} failed:`, err);
    }
  }

  private async renegotiate(peerId: string, pc: RTCPeerConnection): Promise<void> {
    if (this.makingOffer.has(peerId)) return;
    this.makingOffer.add(peerId);
    try {
      const offer = await pc.createOffer();
      const modifiedSdp = enableStereoOpus(offer.sdp ?? '');
      await pc.setLocalDescription({ ...offer, sdp: modifiedSdp });
      this.sendSignal({
        type: 'offer',
        fromId: this.myId,
        toId: peerId,
        sdp: pc.localDescription!,
      });
    } catch (err) {
      console.error(`Renegotiation with ${peerId} failed:`, err);
    } finally {
      this.makingOffer.delete(peerId);
    }
  }

  removeConnection(peerId: string): void {
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
      this.remoteStreams.delete(peerId);
      this.makingOffer.delete(peerId);
      this.onRemoteStreamRemoved(peerId);
    }
  }

  closeAll(): void {
    for (const [peerId] of this.connections) {
      this.removeConnection(peerId);
    }
  }

  getConnection(peerId: string): RTCPeerConnection | undefined {
    return this.connections.get(peerId);
  }

  getAllPeerIds(): string[] {
    return [...this.connections.keys()];
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    if (this.connections.has(peerId)) {
      this.connections.get(peerId)!.close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.connections.set(peerId, pc);

    const activeStream = this.screenStream ?? this.localStream;
    const audioTrack = this.localStream?.getAudioTracks()[0];
    const videoTrack = activeStream?.getVideoTracks()[0];

    // Always create both audio and video transceivers so the initial SDP
    // has m=audio and m=video lines. This avoids needing to add new m-lines
    // later (which requires complex renegotiation).
    if (audioTrack && this.localStream) {
      pc.addTrack(audioTrack, this.localStream);
    } else {
      // Use sendrecv so the remote side fires ontrack for audio immediately,
      // even though we're not sending a real track yet. This ensures the
      // remote stream has an audio track from the start, enabling audio
      // level detection and speaking indicators once we unmute.
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    if (videoTrack && activeStream) {
      pc.addTrack(videoTrack, activeStream);
    } else {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.ontrack = (event) => {
      // Accumulate tracks into a single managed stream per peer.
      // This handles the case where audio/video arrive via separate
      // ontrack events (especially when using addTransceiver without a stream).
      let remoteStream = this.remoteStreams.get(peerId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.remoteStreams.set(peerId, remoteStream);
      }
      // Replace existing track of same kind to avoid duplicates on renegotiation
      const existingTrack = remoteStream.getTracks().find((t) => t.kind === event.track.kind);
      if (existingTrack && existingTrack !== event.track) {
        remoteStream.removeTrack(existingTrack);
      }
      if (!remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track);
      }
      this.onRemoteStream(peerId, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'ice-candidate',
          fromId: this.myId,
          toId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`Connection to ${peerId} failed`);
        this.removeConnection(peerId);
      }
    };

    return pc;
  }
}
