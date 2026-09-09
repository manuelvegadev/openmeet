import { appendFileSync, mkdirSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import type { WSMessage } from '@openmeet/shared';
import { VU_BAR_COUNT, VU_MAX_RMS } from '../lib/audio/constants.js';
import { type AudioDeviceSelection, AudioManager } from '../lib/audio/index.js';
import { createNoiseSuppressor } from '../lib/audio/noise-suppression.js';
import { isBroadcastDevice } from '../lib/audio/nvidia-broadcast.js';
import type { ScreenDevice } from '../lib/devices.js';
import { diagnosticsEnabled, fileLoggingEnabled, startLoopDelayMonitor } from '../lib/diagnostics.js';
import { CONFIG_DIR, loadSettings, saveSettings } from '../lib/settings.js';
import { warmTools } from '../lib/tool-path.js';
import { createVideoSource, VideoManager } from '../lib/video.js';
import { createAudioSource, PeerConnectionManager } from '../lib/webrtc.js';
import { WebSocketClient } from '../lib/websocket.js';
import {
  type ConnectionStats,
  type EngineEvent,
  initialRoomState,
  type JoinOptions,
  type RoomEvent,
  type RoomState,
} from './protocol.js';

/** Levels are quantized to the VU meter's resolution so snapshots only change per bar. */
const LEVEL_STEP = VU_MAX_RMS / VU_BAR_COUNT;
/** Snapshots are coalesced: at most one every SNAPSHOT_INTERVAL_MS. */
const SNAPSHOT_INTERVAL_MS = 100;

interface PrevStatsEntry {
  audioBytesSent: number;
  audioBytesRecv: number;
  packetsRecv: number;
  packetsLost: number;
  timestamp: number;
}

interface PeerPrevStats {
  bytesRecv: number;
  timestamp: number;
}

/**
 * The room session, free of any UI concern. Runs in the engine process and reports through
 * `emit`. This is the former `useRoom` hook with React state replaced by one plain state
 * object and coalesced snapshots.
 */
export class RoomEngine {
  private readonly emit: (event: EngineEvent) => void;
  private state: RoomState = initialRoomState();
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private eventSeq = 0;

  private options: JoinOptions | null = null;
  private ws: WebSocketClient | null = null;
  private peerManager: PeerConnectionManager | null = null;
  private audioManager: AudioManager | null = null;
  private videoManager: VideoManager | null = null;
  private videoSource: any = null;
  private screenSource: { source: any; track: any } | null = null;
  private readonly screenTracks = new Map<string, any>();
  private readonly webcamTracks = new Map<string, any>();

  private logFile: string | null = null;
  private readonly fileOnlyLog = fileLoggingEnabled();
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private visible = true;
  private stopLoopMonitor: (() => void) | null = null;

  constructor(emit: (event: EngineEvent) => void) {
    this.emit = emit;
    // File logging requested up front: capture engine events that happen before any join
    // (device listing, mic test, window watcher) instead of only from the room onwards.
    if (this.fileOnlyLog) this.openLogFile();
  }

  // ─── State / snapshots ───────────────────────────────────────────────

  private patch(partial: Partial<RoomState>): void {
    this.state = { ...this.state, ...partial };
    this.scheduleSnapshot();
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.emit({ type: 'state', state: this.state });
    }, SNAPSHOT_INTERVAL_MS);
  }

  private flushSnapshot(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.emit({ type: 'state', state: this.state });
  }

  private addEvent(message: string, type: RoomEvent['type']): void {
    const event: RoomEvent = { id: ++this.eventSeq, timestamp: Date.now(), message, type };
    this.emit({ type: 'room-event', event });
  }

  private readonly debugFn = (message: string): void => {
    if (this.state.debugMode && !this.fileOnlyLog) this.addEvent(message, 'debug');
    this.log(message);
  };

  /** Append to the debug log file when debugging (or OPENMEET_LOG=1) is on. */
  log(message: string): void {
    if (!this.logFile) return;
    try {
      appendFileSync(this.logFile, `[${new Date().toISOString()}] ${message}\n`);
    } catch {
      // Non-fatal
    }
  }

  private openLogFile(): void {
    if (this.logFile) return;
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      this.logFile = join(CONFIG_DIR, 'debug.log');
      appendFileSync(
        this.logFile,
        `\n--- Session started ${new Date().toISOString()} (engine pid ${process.pid}) ---\n`,
      );
    } catch {
      this.logFile = null;
    }
  }

  private resolveName(peerId: string): string {
    return this.state.participants.find((p) => p.id === peerId)?.username ?? peerId.slice(0, 6);
  }

  // ─── Join / leave ────────────────────────────────────────────────────

  join(options: JoinOptions): void {
    if (this.options) this.leave();
    this.options = options;
    this.state = {
      ...initialRoomState(),
      videoEnabled: options.videoEnabled,
      webcamEnabled: options.webcamEnabled,
      debugMode: options.debug,
    };
    const diagnostics = diagnosticsEnabled(options.debug);
    if (diagnostics) this.openLogFile();
    const debugFn = diagnostics ? this.debugFn : undefined;
    raiseProcessPriority(this.debugFn);

    const ws = new WebSocketClient(options.serverUrl, { onDebug: debugFn });
    this.ws = ws;

    const { source, track } = createAudioSource();
    const audioManager = new AudioManager(source, options.deviceSelection, {
      onDebug: debugFn,
      inputChannels: options.input.channels,
      inputGainDb: options.input.gainDb,
    });

    if (options.noiseSuppression && isBroadcastDevice(options.deviceSelection.input)) {
      // Broadcast denoises on the GPU before the signal reaches any API we control, so
      // RNNoise here would spend 0.22 ms of every 10 ms frame cleaning clean audio — on the
      // one loop that cannot afford it. The setting is left alone; only this call is skipped.
      debugFn?.('Noise suppression: left to NVIDIA Broadcast (GPU)');
      this.addEvent('Noise suppression: NVIDIA Broadcast is handling it on the GPU', 'info');
    } else if (options.noiseSuppression) {
      // Not awaited: loading the wasm costs ~10 ms and joining should not wait for it. The
      // processor chain is consulted per frame, so it takes effect as soon as it is attached
      // and the handful of frames before that simply go through unprocessed.
      void createNoiseSuppressor().then((suppressor) => {
        if (suppressor) {
          audioManager.addCaptureProcessor(suppressor);
          debugFn?.('Noise suppression: RNNoise active');
        } else {
          this.addEvent('Noise suppression unavailable — continuing without it', 'info');
        }
      });
    }
    audioManager.setSpeakingCallback((id, speaking) => {
      this.patch({ speakingStates: { ...this.state.speakingStates, [id]: speaking } });
    });
    this.audioManager = audioManager;

    let videoManager: VideoManager | null = null;
    let videoTrack: any = null;
    if (options.videoEnabled) {
      const videoResult = createVideoSource();
      videoTrack = videoResult.track;
      this.videoSource = videoResult.source;
      videoManager = new VideoManager({ onDebug: debugFn });
      videoManager.overlayEnabled = loadSettings().videoOverlay;
      videoManager.onWindowClosed = (peerId) => {
        this.patch({ peerVideoOpen: { ...this.state.peerVideoOpen, [peerId]: false } });
      };
      videoManager.onScreenCaptureEnded = () => {
        // Our own stopScreenShare() clears the flag before killing ffmpeg; anything else is a failure.
        if (!this.state.isScreenSharing) return;
        this.stopScreenShare();
        this.addEvent('Screen sharing stopped: capture failed (check screen recording permission / ffmpeg)', 'screen');
      };
      this.videoManager = videoManager;
      this.state.overlayEnabled = videoManager.overlayEnabled;
    }

    const peerManager = new PeerConnectionManager({
      myId: '',
      audioTrack: track,
      videoTrack,
      audioSendKbps: options.bitrate.sendKbps,
      audioReceiveKbps: options.bitrate.receiveKbps,
      sendSignal: (msg) => ws.send(msg),
      onRemoteAudioTrack: (peerId, remoteTrack) => audioManager.addRemotePeer(peerId, remoteTrack),
      onRemoteVideoTrack: (peerId, remoteTrack, streamType) => {
        if (!videoManager) return;
        // Tracks are only attached to a window when the user opens it (w / e keys).
        if (streamType === 'screen') this.screenTracks.set(peerId, remoteTrack);
        else this.webcamTracks.set(peerId, remoteTrack);
      },
      onPeerDisconnected: (peerId) => {
        audioManager.removeRemotePeer(peerId);
        videoManager?.removeAllForPeer(peerId);
        this.webcamTracks.delete(peerId);
      },
      onDebug: debugFn,
    });
    this.peerManager = peerManager;

    ws.subscribe((msg) => this.handleSignal(msg));
    ws.onConnectionChange((isConnected) => {
      this.patch({ connected: isConnected });
      if (isConnected && !this.state.joined) {
        ws.send({ type: 'join-room', roomId: options.roomId, username: options.username });
      }
      if (!isConnected) {
        this.patch({ joined: false });
        peerManager.closeAll();
      }
    });

    ws.connect();
    if (this.visible) {
      this.startLevelPolling();
      this.startStatsPolling();
    }
    this.startDiagnostics();
    this.flushSnapshot();
  }

  leave(): void {
    this.stopTimers();
    this.videoManager?.stopScreenCapture();
    this.peerManager?.setScreenTrack(null);
    this.videoManager?.shutdown();
    this.audioManager?.shutdown();
    this.peerManager?.closeAll();
    this.ws?.disconnect();
    this.ws = null;
    this.peerManager = null;
    this.audioManager = null;
    this.videoManager = null;
    this.videoSource = null;
    this.screenSource = null;
    this.screenTracks.clear();
    this.webcamTracks.clear();
    this.options = null;
    this.state = initialRoomState();
    this.flushSnapshot();
    this.emit({ type: 'left' });
  }

  shutdown(): void {
    if (this.options) this.leave();
    else this.stopTimers();
  }

  private stopPolling(): void {
    for (const t of [this.levelTimer, this.statsTimer]) if (t) clearInterval(t);
    this.levelTimer = null;
    this.statsTimer = null;
  }

  private stopTimers(): void {
    this.stopPolling();
    this.stopLoopMonitor?.();
    this.stopLoopMonitor = null;
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  // ─── Signaling ───────────────────────────────────────────────────────

  private handleSignal(msg: WSMessage): void {
    const { ws, peerManager, audioManager, videoManager, options } = this;
    if (!ws || !peerManager || !audioManager || !options) return;

    switch (msg.type) {
      case 'room-joined': {
        peerManager.setMyId(msg.yourId);
        this.patch({ joined: true, myId: msg.yourId, participants: msg.participants, joinedAt: Date.now() });
        this.addEvent('You joined the room', 'info');
        for (const p of msg.participants) this.addEvent(`${p.username} is in the room`, 'info');

        void audioManager.start();
        if (videoManager && this.videoSource && options.webcamEnabled) {
          const device = options.videoDevice ?? loadSettings().videoDeviceId ?? undefined;
          videoManager.startCapture(this.videoSource, device);
        }

        // Wait for the first captured frame so the offer carries a live audio track;
        // 2 s cap so a slow device doesn't block connections.
        const participants = msg.participants;
        Promise.race([audioManager.ready, new Promise<void>((r) => setTimeout(r, 2000))]).then(() => {
          if (this.peerManager !== peerManager) return;
          for (const p of participants) peerManager.createConnection(p.id);
        });

        this.broadcastStates();
        break;
      }

      case 'participant-joined': {
        this.patch({ participants: [...this.state.participants, msg.participant] });
        this.addEvent(`${msg.participant.username} joined`, 'join');
        this.broadcastStates();
        break;
      }

      case 'participant-left': {
        const id = msg.participantId;
        const leaving = this.state.participants.find((p) => p.id === id);
        if (leaving) this.addEvent(`${leaving.username} left`, 'leave');
        peerManager.removeConnection(id);
        videoManager?.removeAllForPeer(id);
        this.screenTracks.delete(id);
        this.webcamTracks.delete(id);
        const without = <T>(rec: Record<string, T>) => {
          const next = { ...rec };
          delete next[id];
          return next;
        };
        this.patch({
          participants: this.state.participants.filter((p) => p.id !== id),
          remoteMuteStates: without(this.state.remoteMuteStates),
          remoteVideoMuteStates: without(this.state.remoteVideoMuteStates),
          remoteScreenShareStates: without(this.state.remoteScreenShareStates),
          peerVideoOpen: without(this.state.peerVideoOpen),
          peerScreenOpen: without(this.state.peerScreenOpen),
          speakingStates: without(this.state.speakingStates),
          peerVolumes: without(this.state.peerVolumes),
        });
        break;
      }

      case 'offer':
        peerManager.handleOffer(msg.fromId, msg.sdp);
        break;
      case 'answer':
        peerManager.handleAnswer(msg.fromId, msg.sdp);
        break;
      case 'ice-candidate':
        peerManager.handleIceCandidate(msg.fromId, msg.candidate);
        break;

      case 'mute-state': {
        const wasMuted = this.state.remoteMuteStates[msg.fromId];
        if (wasMuted !== undefined && wasMuted !== msg.isAudioMuted) {
          this.addEvent(`${this.resolveName(msg.fromId)} ${msg.isAudioMuted ? 'muted' : 'unmuted'}`, 'mute');
        }
        this.patch({
          remoteMuteStates: { ...this.state.remoteMuteStates, [msg.fromId]: msg.isAudioMuted },
          remoteVideoMuteStates: { ...this.state.remoteVideoMuteStates, [msg.fromId]: msg.isVideoMuted ?? false },
        });
        break;
      }

      case 'screen-share-state': {
        const wasSharing = this.state.remoteScreenShareStates[msg.fromId];
        if (wasSharing !== undefined && wasSharing !== msg.isScreenSharing) {
          this.addEvent(
            `${this.resolveName(msg.fromId)} ${msg.isScreenSharing ? 'started' : 'stopped'} screen sharing`,
            'screen',
          );
        }
        const patch: Partial<RoomState> = {
          remoteScreenShareStates: { ...this.state.remoteScreenShareStates, [msg.fromId]: msg.isScreenSharing },
        };
        if (!msg.isScreenSharing) {
          videoManager?.removeRemotePeer(msg.fromId, 'screen');
          patch.peerScreenOpen = { ...this.state.peerScreenOpen, [msg.fromId]: false };
        }
        this.patch(patch);
        break;
      }

      case 'chat-broadcast':
        this.emit({ type: 'chat', message: msg.message });
        break;

      case 'error':
        this.patch({ error: msg.message });
        break;
    }
  }

  /** Tell the room our mute / screen state (on join, on toggles, and when someone joins). */
  private broadcastStates(): void {
    const { ws, state } = this;
    if (!ws || !state.myId || !state.joined) return;
    ws.send({
      type: 'mute-state',
      fromId: state.myId,
      isAudioMuted: state.isMuted,
      isVideoMuted: this.videoManager?.isVideoMuted ?? true,
    });
    ws.send({ type: 'screen-share-state', fromId: state.myId, isScreenSharing: state.isScreenSharing });
  }

  // ─── Commands ────────────────────────────────────────────────────────

  sendChat(content: string): void {
    const { ws, options } = this;
    if (!ws || !options || !content.trim()) return;
    ws.send({
      type: 'chat-message',
      id: '',
      roomId: options.roomId,
      username: options.username,
      content: content.trim(),
      timestamp: 0,
    });
  }

  toggleMute(): void {
    if (!this.audioManager) return;
    const isMuted = this.audioManager.toggleMute();
    this.patch({ isMuted });
    this.broadcastStates();
  }

  toggleVideo(): void {
    if (!this.videoManager) return;
    const isVideoMuted = this.videoManager.toggleMute();
    this.patch({ isVideoMuted });
    this.broadcastStates();
  }

  toggleOverlay(): void {
    if (!this.videoManager) return;
    this.videoManager.overlayEnabled = !this.videoManager.overlayEnabled;
    saveSettings({ videoOverlay: this.videoManager.overlayEnabled });
    this.patch({ overlayEnabled: this.videoManager.overlayEnabled });
  }

  startScreenShare(device: ScreenDevice): void {
    const { videoManager, peerManager } = this;
    if (!videoManager || !peerManager) return;
    if (!this.screenSource) this.screenSource = createVideoSource({ isScreencast: true });
    videoManager.startScreenCapture(this.screenSource.source, device);
    peerManager.setScreenTrack(this.screenSource.track);
    this.patch({ isScreenSharing: true });
    this.broadcastStates();
  }

  stopScreenShare(): void {
    this.videoManager?.stopScreenCapture();
    this.peerManager?.setScreenTrack(null);
    this.patch({ isScreenSharing: false });
    this.broadcastStates();
  }

  togglePeerVideo(peerId: string): void {
    const vm = this.videoManager;
    if (!vm) return;
    if (this.state.peerVideoOpen[peerId]) {
      vm.removeRemotePeer(peerId, 'webcam');
      this.patch({ peerVideoOpen: { ...this.state.peerVideoOpen, [peerId]: false } });
      return;
    }
    const track = this.webcamTracks.get(peerId);
    if (track) vm.addRemotePeer(peerId, track, 'webcam', this.resolveName(peerId));
    this.patch({ peerVideoOpen: { ...this.state.peerVideoOpen, [peerId]: true } });
  }

  togglePeerScreen(peerId: string): void {
    const vm = this.videoManager;
    if (!vm) return;
    if (this.state.peerScreenOpen[peerId]) {
      vm.removeRemotePeer(peerId, 'screen');
      this.patch({ peerScreenOpen: { ...this.state.peerScreenOpen, [peerId]: false } });
      return;
    }
    const track = this.screenTracks.get(peerId);
    if (track) vm.addRemotePeer(peerId, track, 'screen', this.resolveName(peerId));
    this.patch({ peerScreenOpen: { ...this.state.peerScreenOpen, [peerId]: true } });
  }

  setPeerVolume(peerId: string, volume: number): void {
    const applied = this.audioManager?.setVolume(peerId, volume);
    if (applied !== undefined) this.patch({ peerVolumes: { ...this.state.peerVolumes, [peerId]: applied } });
  }

  updateDevices(selection: AudioDeviceSelection): void {
    void this.audioManager?.updateDevices(selection);
  }

  /**
   * Nobody is looking: stop the polls that only feed the display (VU levels, stats). Audio
   * and signaling are untouched. On return, resume and push a fresh snapshot.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.options) return;
    if (visible) {
      this.startLevelPolling();
      this.startStatsPolling();
      this.flushSnapshot();
    } else {
      this.stopPolling();
    }
  }

  toggleDebug(): void {
    const next = !this.state.debugMode;
    this.patch({ debugMode: next });
    if (next) this.openLogFile();
    this.addEvent(`Debug mode ${next ? 'enabled' : 'disabled'}`, 'info');
    const fn = diagnosticsEnabled(next) ? this.debugFn : undefined;
    if (this.ws) this.ws.onDebug = fn;
    if (this.peerManager) this.peerManager.onDebug = fn;
    if (this.audioManager) this.audioManager.onDebug = fn;
    if (this.videoManager) this.videoManager.onDebug = fn;
  }

  // ─── Periodic work ───────────────────────────────────────────────────

  private startLevelPolling(): void {
    if (this.levelTimer) return;
    this.levelTimer = setInterval(() => {
      const am = this.audioManager;
      if (!am) return;
      // Quantized so a snapshot only goes out when a VU bar actually changes.
      const raw = am.getAllAudioLevels();
      const next: Record<string, number> = {};
      for (const [id, rms] of Object.entries(raw)) {
        next[id] = Math.min(Math.round(rms / LEVEL_STEP), VU_BAR_COUNT) * LEVEL_STEP;
      }
      const prev = this.state.audioLevels;
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) return;
      this.patch({ audioLevels: next });
    }, 100);
  }

  private startDiagnostics(): void {
    if (!diagnosticsEnabled(this.state.debugMode)) return;
    this.stopLoopMonitor = startLoopDelayMonitor('Engine', (line) => this.log(line));
  }

  private startStatsPolling(): void {
    if (this.statsTimer) return;
    let prev: PrevStatsEntry | null = null;
    const peerPrevStats = new Map<string, PeerPrevStats>();

    const poll = async () => {
      const pm = this.peerManager;
      if (!pm) return;
      const peerIds = pm.getAllPeerIds();
      if (peerIds.length === 0) {
        if (this.state.connectionStats) this.patch({ connectionStats: null });
        prev = null;
        peerPrevStats.clear();
        return;
      }

      let totalAudioBytesSent = 0;
      let totalAudioBytesRecv = 0;
      let totalPacketsRecv = 0;
      let totalPacketsLost = 0;
      let rttSum = 0;
      let rttCount = 0;
      const peerBytesRecv: Record<string, number> = {};
      const peerLatencyMs: Record<string, number> = {};

      for (const peerId of peerIds) {
        const pc = pm.getConnection(peerId);
        if (!pc || typeof pc.getStats !== 'function') continue;
        let peerRecv = 0;
        let peerRttSum = 0;
        let peerRttCount = 0;
        let jitterSec = 0;
        try {
          const report = await pc.getStats();
          const stats = report.values ? [...report.values()] : [];
          for (const stat of stats) {
            if (stat.type === 'outbound-rtp' && stat.kind === 'audio') totalAudioBytesSent += stat.bytesSent ?? 0;
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
              const bytes = stat.bytesReceived ?? 0;
              totalAudioBytesRecv += bytes;
              peerRecv += bytes;
              totalPacketsRecv += stat.packetsReceived ?? 0;
              totalPacketsLost += stat.packetsLost ?? 0;
              if (stat.jitter != null) jitterSec = stat.jitter;
              if (this.state.debugMode) {
                // NetEQ's time-stretching (accel/decel) and concealment are what make speech
                // sound metallic when packet arrival is irregular.
                const jbMs =
                  stat.jitterBufferEmittedCount > 0
                    ? Math.round((stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000)
                    : 0;
                this.debugFn(
                  `NetEQ ${peerId.slice(0, 6)}: jitter ${Math.round((stat.jitter ?? 0) * 1000)}ms, jb ${jbMs}ms, accel ${stat.removedSamplesForAcceleration ?? 0}, decel ${stat.insertedSamplesForDeceleration ?? 0}, concealed ${stat.concealedSamples ?? 0}, events ${stat.concealmentEvents ?? 0}`,
                );
              }
            }
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.currentRoundTripTime != null) {
              rttSum += stat.currentRoundTripTime * 1000;
              rttCount++;
              peerRttSum += stat.currentRoundTripTime * 1000;
              peerRttCount++;
            }
            if (stat.type === 'remote-inbound-rtp' && stat.roundTripTime != null) {
              rttSum += stat.roundTripTime * 1000;
              rttCount++;
              peerRttSum += stat.roundTripTime * 1000;
              peerRttCount++;
            }
          }
        } catch {
          // Connection may have closed
        }
        peerBytesRecv[peerId] = peerRecv;
        // One-way latency estimate: RTT/2 + jitter buffer estimate + processing overhead
        if (peerRttCount > 0) {
          const peerRttMs = peerRttSum / peerRttCount;
          peerLatencyMs[peerId] = Math.round(peerRttMs / 2 + Math.max(jitterSec * 1000 * 2, 20) + 20);
        }
      }

      const now = Date.now();
      if (prev) {
        const timeDelta = (now - prev.timestamp) / 1000;
        if (timeDelta > 0) {
          const peerRecvBitrateKbps: Record<string, number> = {};
          for (const peerId of peerIds) {
            const prevPeer = peerPrevStats.get(peerId);
            if (prevPeer) {
              const dt = (now - prevPeer.timestamp) / 1000;
              if (dt > 0) {
                peerRecvBitrateKbps[peerId] = Math.max(
                  0,
                  Math.round(((peerBytesRecv[peerId] - prevPeer.bytesRecv) * 8) / dt / 1000),
                );
              }
            }
          }
          const newPacketsRecv = totalPacketsRecv - prev.packetsRecv;
          const newPacketsLost = totalPacketsLost - prev.packetsLost;
          const totalNew = newPacketsRecv + newPacketsLost;
          const stats: ConnectionStats = {
            sendBitrateKbps: Math.max(
              0,
              Math.round(((totalAudioBytesSent - prev.audioBytesSent) * 8) / timeDelta / 1000),
            ),
            recvBitrateKbps: Math.max(
              0,
              Math.round(((totalAudioBytesRecv - prev.audioBytesRecv) * 8) / timeDelta / 1000),
            ),
            rttMs: rttCount > 0 ? Math.round(rttSum / rttCount) : 0,
            packetLossPercent: totalNew > 0 ? Math.round((newPacketsLost / totalNew) * 1000) / 10 : 0,
            peerRecvBitrateKbps,
            peerLatencyMs,
          };
          this.patch({ connectionStats: stats });
          if (this.state.debugMode) {
            this.debugFn(
              `Stats: ↑${stats.sendBitrateKbps}k ↓${stats.recvBitrateKbps}k RTT:${stats.rttMs}ms Loss:${stats.packetLossPercent}%`,
            );
          }
        }
      }

      for (const peerId of peerIds)
        peerPrevStats.set(peerId, { bytesRecv: peerBytesRecv[peerId] ?? 0, timestamp: now });
      for (const peerId of peerPrevStats.keys()) if (!peerIds.includes(peerId)) peerPrevStats.delete(peerId);
      prev = {
        audioBytesSent: totalAudioBytesSent,
        audioBytesRecv: totalAudioBytesRecv,
        packetsRecv: totalPacketsRecv,
        packetsLost: totalPacketsLost,
        timestamp: now,
      };
    };

    this.statsTimer = setInterval(() => void poll(), 2000);
  }
}

/**
 * Ask Windows to schedule this process ahead of ordinary background work.
 *
 * RtAudio's WASAPI thread already registers with MMCSS as "Pro Audio", but the mixing and
 * the hand-off to WebRTC happen on this process's event loop, which is an ordinary thread —
 * and a fullscreen game, with Game Mode deprioritizing background apps, wins against it.
 * `PRIORITY_HIGH` maps to HIGH_PRIORITY_CLASS and needs no elevation; `PRIORITY_HIGHEST`
 * would be silently downgraded without it. Windows only: the POSIX equivalent is a negative
 * nice value, which requires root and would only throw.
 */
function raiseProcessPriority(log: (message: string) => void): void {
  if (process.platform !== 'win32') return;
  try {
    setPriority(constants.priority.PRIORITY_HIGH);
    log(`Engine process priority raised to high (pid ${process.pid})`);
  } catch (err) {
    log(`Engine process priority unchanged: ${err}`);
  }
}
