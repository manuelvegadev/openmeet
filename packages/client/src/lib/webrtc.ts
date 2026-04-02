import type { WSMessage } from '@openmeet/shared';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

// Fixed transceiver indices — both peers create m-lines in this order.
const AUDIO_INDEX = 0;
const WEBCAM_INDEX = 1;
const SCREEN_INDEX = 2;

function boostOpusQuality(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) (.+)/g, (match, pt, params) => {
    if (params.includes('minptime')) {
      let modified = params;
      if (!modified.includes('stereo')) {
        modified += ';stereo=1';
      }
      if (!modified.includes('sprop-stereo')) {
        modified += ';sprop-stereo=1';
      }
      if (!modified.includes('maxaveragebitrate')) {
        modified += ';maxaveragebitrate=256000';
      } else {
        modified = modified.replace(/maxaveragebitrate=\d+/, 'maxaveragebitrate=256000');
      }
      return `a=fmtp:${pt} ${modified}`;
    }
    return match;
  });
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
  private pendingRenegotiation = new Set<string>();
  private retryCount = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static MAX_RETRIES = 3;

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

  // ---------------------------------------------------------------------------
  // Core track synchronisation
  // ---------------------------------------------------------------------------

  /**
   * Ensures the correct local tracks are attached to the correct transceivers
   * using fixed indices (0 = audio, 1 = webcam, 2 = screen).
   *
   * replaceTrack() is always safe — it works without renegotiation.
   * Returns true only when a transceiver *direction* changed, which requires
   * a new offer/answer exchange.
   */
  private syncLocalTracks(pc: RTCPeerConnection): boolean {
    const transceivers = pc.getTransceivers();
    if (transceivers.length < 3) return false;

    let directionChanged = false;

    // Audio (index 0): always sendrecv so ontrack fires on the remote
    const audioTrack = this.localStream?.getAudioTracks()[0] ?? null;
    if (transceivers[AUDIO_INDEX].sender.track !== audioTrack) {
      transceivers[AUDIO_INDEX].sender.replaceTrack(audioTrack);
    }
    if (transceivers[AUDIO_INDEX].direction !== 'sendrecv') {
      transceivers[AUDIO_INDEX].direction = 'sendrecv';
      directionChanged = true;
    }

    // Webcam video (index 1): always sendrecv
    const videoTrack = this.localStream?.getVideoTracks()[0] ?? null;
    if (transceivers[WEBCAM_INDEX].sender.track !== videoTrack) {
      transceivers[WEBCAM_INDEX].sender.replaceTrack(videoTrack);
    }
    if (transceivers[WEBCAM_INDEX].direction !== 'sendrecv') {
      transceivers[WEBCAM_INDEX].direction = 'sendrecv';
      directionChanged = true;
    }

    // Screen video (index 2): sendrecv when sharing, recvonly otherwise
    const screenTrack = this.screenStream?.getVideoTracks()[0] ?? null;
    if (transceivers[SCREEN_INDEX].sender.track !== screenTrack) {
      transceivers[SCREEN_INDEX].sender.replaceTrack(screenTrack);
    }
    const wantedDir = screenTrack ? 'sendrecv' : 'recvonly';
    if (transceivers[SCREEN_INDEX].direction !== wantedDir) {
      transceivers[SCREEN_INDEX].direction = wantedDir;
      directionChanged = true;
    }

    return directionChanged;
  }

  /** Set up onunmute listener on the screen receiver track. */
  private setupScreenTrackListener(peerId: string, pc: RTCPeerConnection): void {
    const screenReceiverTrack = pc.getTransceivers()[SCREEN_INDEX]?.receiver?.track;
    if (screenReceiverTrack) {
      screenReceiverTrack.onunmute = () => {
        this.handleScreenTrack(peerId, screenReceiverTrack);
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — local stream management
  // ---------------------------------------------------------------------------

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const [peerId, pc] of this.connections) {
      if (this.syncLocalTracks(pc)) {
        this.renegotiate(peerId, pc);
      }
    }
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
    for (const [peerId, pc] of this.connections) {
      if (this.syncLocalTracks(pc)) {
        this.renegotiate(peerId, pc);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — connection lifecycle
  // ---------------------------------------------------------------------------

  async createConnection(peerId: string): Promise<void> {
    const pc = this.createOffererConnection(peerId);

    this.makingOffer.add(peerId);
    try {
      const offer = await pc.createOffer();
      const modifiedSdp = boostOpusQuality(offer.sdp ?? '');
      await pc.setLocalDescription({ ...offer, sdp: modifiedSdp });
      this.sendSignal({
        type: 'offer',
        fromId: this.myId,
        toId: peerId,
        sdp: pc.localDescription!,
      });
    } catch (err) {
      console.error(`createConnection to ${peerId} failed:`, err);
    } finally {
      this.makingOffer.delete(peerId);
      this.flushPendingRenegotiation(peerId);
    }
  }

  async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    let pc = this.connections.get(peerId);
    if (!pc) {
      // Answerer path: bare connection, NO transceivers yet.
      pc = this.setupPeerConnection(peerId);
    }

    // Perfect negotiation — detect offer collision (glare)
    const offerCollision = this.makingOffer.has(peerId) || pc.signalingState !== 'stable';
    // Lexicographically smaller ID is the "polite" peer that yields
    const polite = this.myId < peerId;

    if (!polite && offerCollision) {
      // Impolite: ignore incoming offer — remote (polite) will process ours
      return;
    }

    try {
      if (offerCollision) {
        // Polite: rollback our own offer to accept theirs
        await pc.setLocalDescription({ type: 'rollback' });
      }

      // Process offer FIRST — this creates transceivers from the offer's m-lines
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Attach local tracks to the transceivers the offer defined.
      // Direction changes are absorbed by the answer SDP below.
      this.syncLocalTracks(pc);

      // Screen receiver fallback listener
      this.setupScreenTrackListener(peerId, pc);

      const answer = await pc.createAnswer();
      const modifiedSdp = boostOpusQuality(answer.sdp ?? '');
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
      // Verify tracks — local state may have changed during negotiation
      if (this.syncLocalTracks(pc)) {
        this.renegotiate(peerId, pc);
      }
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

  /** Schedule a retry for a failed connection (only impolite peer retries). */
  private scheduleRetry(peerId: string): void {
    if (this.myId < peerId) return;

    const count = this.retryCount.get(peerId) ?? 0;
    if (count >= PeerConnectionManager.MAX_RETRIES) {
      console.warn(`Max retries reached for ${peerId}`);
      this.retryCount.delete(peerId);
      return;
    }

    const delay = 1000 * 2 ** count;
    this.retryCount.set(peerId, count + 1);

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
      this.remoteStreams.delete(peerId);
      this.remoteScreenStreams.delete(peerId);
      this.makingOffer.delete(peerId);
      this.pendingRenegotiation.delete(peerId);
      this.onRemoteStreamRemoved(peerId);
    }
  }

  closeAll(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.retryCount.clear();
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

  // ---------------------------------------------------------------------------
  // Renegotiation with concurrency guard
  // ---------------------------------------------------------------------------

  private async renegotiate(peerId: string, pc: RTCPeerConnection): Promise<void> {
    if (this.makingOffer.has(peerId)) {
      this.pendingRenegotiation.add(peerId);
      return;
    }
    this.makingOffer.add(peerId);
    try {
      // Re-sync tracks right before creating the offer so the SDP is fresh
      this.syncLocalTracks(pc);

      const offer = await pc.createOffer();
      const modifiedSdp = boostOpusQuality(offer.sdp ?? '');
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
      this.flushPendingRenegotiation(peerId);
    }
  }

  private flushPendingRenegotiation(peerId: string): void {
    if (this.pendingRenegotiation.has(peerId)) {
      this.pendingRenegotiation.delete(peerId);
      const pc = this.connections.get(peerId);
      if (pc) this.renegotiate(peerId, pc);
    }
  }

  // ---------------------------------------------------------------------------
  // Remote track handling
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Peer connection setup
  // ---------------------------------------------------------------------------

  /** Create a bare RTCPeerConnection with event handlers but NO transceivers. */
  private setupPeerConnection(peerId: string): RTCPeerConnection {
    if (this.connections.has(peerId)) {
      this.connections.get(peerId)!.close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.connections.set(peerId, pc);

    pc.ontrack = (event) => {
      // Identify track by transceiver index — deterministic, not arrival-order.
      const idx = pc.getTransceivers().indexOf(event.transceiver);

      if (idx === SCREEN_INDEX) {
        this.handleScreenTrack(peerId, event.track);
        return;
      }

      // Fallback for unrecognised transceiver (should not happen in practice)
      if (idx === -1 && event.track.kind === 'video') {
        const remoteStream = this.remoteStreams.get(peerId);
        if (remoteStream && remoteStream.getVideoTracks().length > 0) {
          this.handleScreenTrack(peerId, event.track);
          return;
        }
      }

      // Audio (index 0) or webcam video (index 1) → webcam stream
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
      if (pc.connectionState === 'connected') {
        this.retryCount.delete(peerId);
        this.syncLocalTracks(pc);
      }
      if (pc.connectionState === 'failed') {
        console.warn(`Connection to ${peerId} failed`);
        const existingTimer = this.retryTimers.get(peerId);
        if (existingTimer) clearTimeout(existingTimer);
        this.retryTimers.delete(peerId);
        this.connections.delete(peerId);
        this.remoteStreams.delete(peerId);
        this.remoteScreenStreams.delete(peerId);
        this.makingOffer.delete(peerId);
        this.pendingRenegotiation.delete(peerId);
        this.onRemoteStreamRemoved(peerId);
        this.scheduleRetry(peerId);
      }
    };

    return pc;
  }

  /** Create a peer connection WITH 3 transceivers (offerer path). */
  private createOffererConnection(peerId: string): RTCPeerConnection {
    const pc = this.setupPeerConnection(peerId);

    // Create 3 transceivers in fixed order with encoding priorities
    pc.addTransceiver('audio', {
      direction: 'sendrecv',
      sendEncodings: [{ priority: 'high', networkPriority: 'high' }],
    });
    pc.addTransceiver('video', {
      direction: 'sendrecv',
      sendEncodings: [{ priority: 'low', networkPriority: 'low', maxFramerate: 30 }],
    });
    pc.addTransceiver('video', {
      direction: this.screenStream?.getVideoTracks()[0] ? 'sendrecv' : 'recvonly',
      sendEncodings: [{ priority: 'medium', networkPriority: 'medium', maxFramerate: 60 }],
    });

    // Attach local tracks and set up screen listener
    this.syncLocalTracks(pc);
    this.setupScreenTrackListener(peerId, pc);

    return pc;
  }
}
