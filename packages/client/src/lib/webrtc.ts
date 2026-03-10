import type { WSMessage } from '@openmeet/shared';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

// Screen share is always the 3rd transceiver (index 2).
// Both sides create transceivers in the same order: audio (0), webcam (1), screen (2).
// After SDP exchange, getTransceivers() preserves m-line order.
const SCREEN_TRANSCEIVER_INDEX = 2;

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

function getScreenTransceiver(pc: RTCPeerConnection): RTCRtpTransceiver | undefined {
  return pc.getTransceivers()[SCREEN_TRANSCEIVER_INDEX];
}

export class PeerConnectionManager {
  private connections = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private remoteScreenStreams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private sendSignal: (message: WSMessage) => void;
  private myId: string;
  private onRemoteStream: (peerId: string, stream: MediaStream) => void;
  private onRemoteScreenStream: (peerId: string, stream: MediaStream | null) => void;
  private onRemoteStreamRemoved: (peerId: string) => void;
  private makingOffer = new Set<string>();

  constructor(options: {
    myId: string;
    sendSignal: (msg: WSMessage) => void;
    onRemoteStream: (peerId: string, stream: MediaStream) => void;
    onRemoteScreenStream: (peerId: string, stream: MediaStream | null) => void;
    onRemoteStreamRemoved: (peerId: string) => void;
  }) {
    this.myId = options.myId;
    this.sendSignal = options.sendSignal;
    this.onRemoteStream = options.onRemoteStream;
    this.onRemoteScreenStream = options.onRemoteScreenStream;
    this.onRemoteStreamRemoved = options.onRemoteStreamRemoved;
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const [peerId, pc] of this.connections) {
      let needsRenegotiation = false;
      const screenTransceiver = getScreenTransceiver(pc);

      for (const track of stream.getTracks()) {
        // Find the right transceiver: for audio, find audio transceiver; for video, find webcam video transceiver (not the screen one)
        const transceiver = pc
          .getTransceivers()
          .find((t) => t.receiver.track.kind === track.kind && t !== screenTransceiver);

        if (transceiver) {
          const currentTrack = transceiver.sender.track;
          if (currentTrack && currentTrack !== track) {
            transceiver.sender.replaceTrack(track);
          } else if (!currentTrack) {
            transceiver.sender.replaceTrack(track);
            if (transceiver.direction === 'recvonly') {
              transceiver.direction = 'sendrecv';
              needsRenegotiation = true;
            }
          }
        } else {
          pc.addTrack(track, stream);
          needsRenegotiation = true;
        }
      }

      if (needsRenegotiation) {
        this.renegotiate(peerId, pc);
      }
    }
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
    const screenTrack = stream?.getVideoTracks()[0] ?? null;

    for (const [peerId, pc] of this.connections) {
      const screenTransceiver = getScreenTransceiver(pc);
      if (!screenTransceiver) continue;

      screenTransceiver.sender.replaceTrack(screenTrack);

      const newDirection = screenTrack ? 'sendrecv' : 'recvonly';
      if (screenTransceiver.direction !== newDirection) {
        screenTransceiver.direction = newDirection;
        this.renegotiate(peerId, pc);
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
      this.remoteScreenStreams.delete(peerId);
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

  private handleScreenTrack(peerId: string, track: MediaStreamTrack): void {
    let screenStream = this.remoteScreenStreams.get(peerId);
    if (!screenStream) {
      screenStream = new MediaStream();
      this.remoteScreenStreams.set(peerId, screenStream);
    }
    const existingTrack = screenStream.getTracks().find((t) => t.kind === track.kind);
    if (existingTrack && existingTrack !== track) {
      screenStream.removeTrack(existingTrack);
    }
    if (!screenStream.getTracks().includes(track)) {
      screenStream.addTrack(track);
    }
    this.onRemoteScreenStream(peerId, new MediaStream(screenStream.getTracks()));
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    if (this.connections.has(peerId)) {
      this.connections.get(peerId)!.close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.connections.set(peerId, pc);

    const audioTrack = this.localStream?.getAudioTracks()[0];
    const webcamTrack = this.localStream?.getVideoTracks()[0];
    const screenTrack = this.screenStream?.getVideoTracks()[0];

    // Transceiver 0: Audio
    if (audioTrack && this.localStream) {
      pc.addTrack(audioTrack, this.localStream);
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    // Transceiver 1: Webcam video — always sendrecv so ontrack fires on the
    // remote immediately and replaceTrack works without renegotiation when the
    // camera stream arrives late (e.g. after a page reload).
    if (webcamTrack && this.localStream) {
      pc.addTrack(webcamTrack, this.localStream);
    } else {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    // Transceiver 2: Screen share video
    if (screenTrack && this.screenStream) {
      pc.addTrack(screenTrack, this.screenStream);
    } else {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    // Fallback: listen for the screen receiver track's unmute event.
    // During renegotiation ontrack may not fire for an existing transceiver
    // whose direction changed from inactive → sendrecv. The track's unmute
    // event reliably signals the remote started sending screen content.
    const screenReceiverTrack = getScreenTransceiver(pc)?.receiver?.track;
    if (screenReceiverTrack) {
      screenReceiverTrack.onunmute = () => {
        this.handleScreenTrack(peerId, screenReceiverTrack);
      };
    }

    pc.ontrack = (event) => {
      // Route video tracks by arrival order instead of transceiver identification.
      // ontrack fires in m-line order: audio (0), webcam video (1), screen video (2).
      // If we already have a webcam video track, any new video track is the screen.
      if (event.track.kind === 'video') {
        const remoteStream = this.remoteStreams.get(peerId);
        if (remoteStream && remoteStream.getVideoTracks().length > 0) {
          this.handleScreenTrack(peerId, event.track);
          return;
        }
      }

      // Audio or first webcam video → webcam stream
      let remoteStream = this.remoteStreams.get(peerId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.remoteStreams.set(peerId, remoteStream);
      }
      const existingTrack = remoteStream.getTracks().find((t) => t.kind === event.track.kind);
      if (existingTrack && existingTrack !== event.track) {
        remoteStream.removeTrack(existingTrack);
      }
      if (!remoteStream.getTracks().includes(event.track)) {
        remoteStream.addTrack(event.track);
      }
      this.onRemoteStream(peerId, new MediaStream(remoteStream.getTracks()));
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
