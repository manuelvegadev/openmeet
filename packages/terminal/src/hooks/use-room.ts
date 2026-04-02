import type { ChatMessage, Participant, WSMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioManager } from '../lib/audio.js';
import type { DeviceEnvs } from '../lib/devices.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { createVideoSource, VideoManager } from '../lib/video.js';
import { createAudioSource, PeerConnectionManager } from '../lib/webrtc.js';
import { WebSocketClient } from '../lib/websocket.js';

export interface ConnectionStats {
  sendBitrateKbps: number;
  recvBitrateKbps: number;
  rttMs: number;
  packetLossPercent: number;
  peerRecvBitrateKbps: Record<string, number>;
  peerLatencyMs: Record<string, number>;
}

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

export interface RoomEvent {
  timestamp: number;
  message: string;
  type: 'join' | 'leave' | 'screen' | 'mute' | 'info' | 'debug';
}

interface UseRoomOptions {
  serverUrl: string;
  roomId: string;
  username: string;
  deviceEnvs: DeviceEnvs;
  debug?: boolean;
  videoEnabled?: boolean;
  videoDevice?: string;
}

interface UseRoomReturn {
  connected: boolean;
  joined: boolean;
  myId: string | null;
  participants: Participant[];
  chatMessages: ChatMessage[];
  remoteMuteStates: Record<string, boolean>;
  remoteVideoMuteStates: Record<string, boolean>;
  remoteScreenShareStates: Record<string, boolean>;
  speakingStates: Record<string, boolean>;
  audioLevels: Record<string, number>;
  peerVolumes: Record<string, number>;
  connectionStats: ConnectionStats | null;
  roomEvents: RoomEvent[];
  joinedAt: number | null;
  isMuted: boolean;
  isVideoMuted: boolean;
  videoEnabled: boolean;
  overlayEnabled: boolean;
  error: string | null;
  debugMode: boolean;
  sendMessage: (content: string) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleOverlay: () => void;
  peerVideoOpen: Record<string, boolean>;
  togglePeerVideo: (peerId: string) => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  updateDevices: (envs: DeviceEnvs) => void;
  toggleDebug: () => void;
  leave: () => void;
}

export function useRoom(options: UseRoomOptions): UseRoomReturn {
  const { serverUrl, roomId, username, deviceEnvs, debug = false, videoEnabled = false, videoDevice } = options;

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [remoteMuteStates, setRemoteMuteStates] = useState<Record<string, boolean>>({});
  const [remoteVideoMuteStates, setRemoteVideoMuteStates] = useState<Record<string, boolean>>({});
  const [remoteScreenShareStates, setRemoteScreenShareStates] = useState<Record<string, boolean>>({});
  const [peerVideoOpen, setPeerVideoOpen] = useState<Record<string, boolean>>({});
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | null>(null);
  const [roomEvents, setRoomEvents] = useState<RoomEvent[]>([]);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(true);
  const [overlayEnabled, setOverlayEnabled] = useState(() => loadSettings().videoOverlay);
  const [error, setError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(debug);

  const debugModeRef = useRef(debug);

  const addEvent = useCallback((message: string, type: RoomEvent['type']) => {
    setRoomEvents((prev) => [...prev, { timestamp: Date.now(), message, type }]);
  }, []);

  const addDebugEvent = useCallback((message: string) => {
    if (debugModeRef.current) {
      setRoomEvents((prev) => [...prev, { timestamp: Date.now(), message, type: 'debug' }]);
    }
  }, []);

  const toggleDebug = useCallback(() => {
    setDebugMode((prev) => {
      const next = !prev;
      debugModeRef.current = next;
      setRoomEvents((events) => [
        ...events,
        { timestamp: Date.now(), message: `Debug mode ${next ? 'enabled' : 'disabled'}`, type: 'info' },
      ]);
      // Update onDebug callbacks on managers
      const ws = wsRef.current;
      const pm = peerManagerRef.current;
      const am = audioManagerRef.current;
      const vm = videoManagerRef.current;
      const debugFn = next ? (msg: string) => addDebugEvent(msg) : undefined;
      if (ws) ws.onDebug = debugFn;
      if (pm) pm.onDebug = debugFn;
      if (am) am.onDebug = debugFn;
      if (vm) vm.onDebug = debugFn;
      return next;
    });
  }, [addDebugEvent]);

  const resolveName = useCallback((peerId: string) => {
    return participantsRef.current.find((p) => p.id === peerId)?.username ?? peerId.slice(0, 6);
  }, []);

  const wsRef = useRef<WebSocketClient | null>(null);
  const peerManagerRef = useRef<PeerConnectionManager | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const videoManagerRef = useRef<VideoManager | null>(null);
  const myIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const participantsRef = useRef<Participant[]>([]);
  const remoteMuteRef = useRef<Record<string, boolean>>({});
  const remoteScreenRef = useRef<Record<string, boolean>>({});
  const screenTracksRef = useRef(new Map<string, any>());
  const webcamTracksRef = useRef(new Map<string, any>());

  const send = useCallback((msg: WSMessage) => {
    wsRef.current?.send(msg);
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      send({
        type: 'chat-message',
        id: '',
        roomId,
        username,
        content: content.trim(),
        contentType: 'text',
        timestamp: 0,
      });
    },
    [send, roomId, username],
  );

  const toggleMute = useCallback(() => {
    const audioManager = audioManagerRef.current;
    if (audioManager) {
      const newMuted = audioManager.toggleMute();
      setIsMuted(newMuted);
      if (myIdRef.current && joinedRef.current) {
        send({
          type: 'mute-state',
          fromId: myIdRef.current,
          isAudioMuted: newMuted,
          isVideoMuted: videoManagerRef.current?.isVideoMuted ?? true,
        });
      }
    }
  }, [send]);

  const toggleVideo = useCallback(() => {
    const vm = videoManagerRef.current;
    if (vm) {
      const newMuted = vm.toggleMute();
      setIsVideoMuted(newMuted);
      if (myIdRef.current && joinedRef.current) {
        send({
          type: 'mute-state',
          fromId: myIdRef.current,
          isAudioMuted: audioManagerRef.current?.isMuted ?? false,
          isVideoMuted: newMuted,
        });
      }
    }
  }, [send]);

  const toggleOverlay = useCallback(() => {
    const vm = videoManagerRef.current;
    if (vm) {
      vm.overlayEnabled = !vm.overlayEnabled;
      setOverlayEnabled(vm.overlayEnabled);
      saveSettings({ videoOverlay: vm.overlayEnabled });
    }
  }, []);

  const togglePeerVideo = useCallback((peerId: string) => {
    const vm = videoManagerRef.current;
    if (!vm) return;

    setPeerVideoOpen((prev) => {
      const isOpen = prev[peerId];
      if (isOpen) {
        // Close the video window
        vm.removeRemotePeer(peerId, 'webcam');
        return { ...prev, [peerId]: false };
      }
      // Open the video window — attach the stored webcam track
      const track = webcamTracksRef.current.get(peerId);
      if (track) {
        const name = participantsRef.current.find((p) => p.id === peerId)?.username ?? peerId.slice(0, 6);
        vm.addRemotePeer(peerId, track, 'webcam', name);
      }
      return { ...prev, [peerId]: true };
    });
  }, []);

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setPeerVolumes((prev) => ({ ...prev, [peerId]: clamped }));
    audioManagerRef.current?.setVolume(peerId, clamped);
  }, []);

  const updateDevices = useCallback((envs: DeviceEnvs) => {
    audioManagerRef.current?.updateDevices(envs);
  }, []);

  const leave = useCallback(() => {
    videoManagerRef.current?.shutdown();
    audioManagerRef.current?.shutdown();
    peerManagerRef.current?.closeAll();
    wsRef.current?.disconnect();
  }, []);

  // Main effect: connect WS, set up WebRTC + audio
  useEffect(() => {
    const debugFn = debugModeRef.current ? (msg: string) => addDebugEvent(msg) : undefined;

    const ws = new WebSocketClient(serverUrl, { onDebug: debugFn });
    wsRef.current = ws;

    const { source, track } = createAudioSource();
    const audioManager = new AudioManager(source, deviceEnvs, { onDebug: debugFn });
    audioManager.setSpeakingCallback((id, speaking) => {
      setSpeakingStates((prev) => ({ ...prev, [id]: speaking }));
    });
    audioManagerRef.current = audioManager;

    // Conditionally create VideoManager when video is enabled
    let videoManager: VideoManager | null = null;
    let videoTrack: any = null;
    let videoSource: any = null;
    if (videoEnabled) {
      const videoResult = createVideoSource();
      videoTrack = videoResult.track;
      videoSource = videoResult.source;
      videoManager = new VideoManager({ onDebug: debugFn });
      videoManager.overlayEnabled = loadSettings().videoOverlay;
      videoManager.onWindowClosed = (peerId) => {
        setPeerVideoOpen((prev) => ({ ...prev, [peerId]: false }));
      };
      videoManagerRef.current = videoManager;
    }

    const peerManager = new PeerConnectionManager({
      myId: '',
      audioTrack: track,
      videoTrack,
      sendSignal: (msg) => ws.send(msg),
      onRemoteAudioTrack: (peerId, remoteTrack) => {
        audioManager.addRemotePeer(peerId, remoteTrack);
      },
      onRemoteVideoTrack: (peerId, remoteTrack, streamType) => {
        if (!videoManager) return;
        if (streamType === 'screen') {
          // Store screen track — only attach when screen-share-state confirms sharing
          screenTracksRef.current.set(peerId, remoteTrack);
        } else {
          // Store webcam track — only attach when user manually opens via togglePeerVideo
          webcamTracksRef.current.set(peerId, remoteTrack);
        }
      },
      onPeerDisconnected: (peerId) => {
        audioManager.removeRemotePeer(peerId);
        videoManager?.removeAllForPeer(peerId);
        webcamTracksRef.current.delete(peerId);
      },
      onDebug: debugFn,
    });
    peerManagerRef.current = peerManager;

    const unsubMessage = ws.subscribe((msg) => {
      switch (msg.type) {
        case 'room-joined': {
          setJoined(true);
          joinedRef.current = true;
          setMyId(msg.yourId);
          myIdRef.current = msg.yourId;
          peerManager.setMyId(msg.yourId);
          setParticipants(msg.participants);
          participantsRef.current = msg.participants;
          setJoinedAt(Date.now());
          addEvent('You joined the room', 'info');
          for (const p of msg.participants) {
            addEvent(`${p.username} is in the room`, 'info');
          }

          // Start audio capture
          audioManager.startCapture();

          // Start video capture (starts muted — sends black frames)
          if (videoManager && videoSource) {
            // CLI flag takes priority, then saved setting
            const device = videoDevice ?? loadSettings().videoDeviceId ?? undefined;
            videoManager.startCapture(videoSource, device);
          }

          // Wait for first audio frame before creating connections so the
          // RTCAudioSource track has real data when the offer is sent.
          // 2s timeout ensures connections still get created if sox is slow.
          const participants = msg.participants;
          const yourId = msg.yourId;
          Promise.race([audioManager.ready, new Promise<void>((r) => setTimeout(r, 2000))]).then(() => {
            for (const p of participants) {
              peerManager.createConnection(p.id);
            }
          });

          // Broadcast initial states
          ws.send({
            type: 'mute-state',
            fromId: yourId,
            isAudioMuted: false,
            isVideoMuted: videoManager?.isVideoMuted ?? true,
          });
          ws.send({
            type: 'screen-share-state',
            fromId: yourId,
            isScreenSharing: false,
          });
          break;
        }

        case 'participant-joined': {
          setParticipants((prev) => {
            const next = [...prev, msg.participant];
            participantsRef.current = next;
            return next;
          });
          addEvent(`${msg.participant.username} joined`, 'join');
          break;
        }

        case 'participant-left': {
          const leaving = participantsRef.current.find((p) => p.id === msg.participantId);
          if (leaving) addEvent(`${leaving.username} left`, 'leave');
          setParticipants((prev) => {
            const next = prev.filter((p) => p.id !== msg.participantId);
            participantsRef.current = next;
            return next;
          });
          peerManager.removeConnection(msg.participantId);
          videoManager?.removeAllForPeer(msg.participantId);
          screenTracksRef.current.delete(msg.participantId);
          webcamTracksRef.current.delete(msg.participantId);
          delete remoteMuteRef.current[msg.participantId];
          setRemoteMuteStates((prev) => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
          setRemoteVideoMuteStates((prev) => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
          setPeerVideoOpen((prev) => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
          delete remoteScreenRef.current[msg.participantId];
          setRemoteScreenShareStates((prev) => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
          break;
        }

        case 'offer': {
          peerManager.handleOffer(msg.fromId, msg.sdp);
          break;
        }

        case 'answer': {
          peerManager.handleAnswer(msg.fromId, msg.sdp);
          break;
        }

        case 'ice-candidate': {
          peerManager.handleIceCandidate(msg.fromId, msg.candidate);
          break;
        }

        case 'mute-state': {
          const wasMuted = remoteMuteRef.current[msg.fromId];
          if (wasMuted !== undefined && wasMuted !== msg.isAudioMuted) {
            addEvent(`${resolveName(msg.fromId)} ${msg.isAudioMuted ? 'muted' : 'unmuted'}`, 'mute');
          }
          remoteMuteRef.current[msg.fromId] = msg.isAudioMuted;
          setRemoteMuteStates((prev) => ({ ...prev, [msg.fromId]: msg.isAudioMuted }));
          setRemoteVideoMuteStates((prev) => ({ ...prev, [msg.fromId]: msg.isVideoMuted }));
          break;
        }

        case 'screen-share-state': {
          const wasSharing = remoteScreenRef.current[msg.fromId];
          if (wasSharing !== undefined && wasSharing !== msg.isScreenSharing) {
            addEvent(
              `${resolveName(msg.fromId)} ${msg.isScreenSharing ? 'started' : 'stopped'} screen sharing`,
              'screen',
            );
          }
          remoteScreenRef.current[msg.fromId] = msg.isScreenSharing;
          setRemoteScreenShareStates((prev) => ({ ...prev, [msg.fromId]: msg.isScreenSharing }));
          if (msg.isScreenSharing) {
            // Attach stored screen track now that sharing is confirmed
            const screenTrack = screenTracksRef.current.get(msg.fromId);
            if (screenTrack && videoManager) {
              const name = participantsRef.current.find((p) => p.id === msg.fromId)?.username ?? msg.fromId.slice(0, 6);
              videoManager.addRemotePeer(msg.fromId, screenTrack, 'screen', name);
            }
          } else {
            videoManager?.removeRemotePeer(msg.fromId, 'screen');
          }
          break;
        }

        case 'chat-broadcast': {
          setChatMessages((prev) => [...prev, msg.message]);
          break;
        }

        case 'error': {
          setError(msg.message);
          break;
        }
      }
    });

    const unsubConnection = ws.onConnectionChange((isConnected) => {
      setConnected(isConnected);
      if (isConnected && !joinedRef.current) {
        ws.send({ type: 'join-room', roomId, username });
      }
      if (!isConnected) {
        setJoined(false);
        joinedRef.current = false;
        peerManager.closeAll();
      }
    });

    ws.connect();

    return () => {
      unsubMessage();
      unsubConnection();
      videoManager?.shutdown();
      audioManager.shutdown();
      peerManager.closeAll();
      ws.disconnect();
    };
  }, [serverUrl, roomId, username, deviceEnvs, videoEnabled, videoDevice, addEvent, addDebugEvent, resolveName]);

  // Re-broadcast mute state when participants change (so newcomers learn our state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: participants.length is an intentional trigger
  useEffect(() => {
    if (myId && joined) {
      send({
        type: 'mute-state',
        fromId: myId,
        isAudioMuted: isMuted,
        isVideoMuted: isVideoMuted,
      });
      send({
        type: 'screen-share-state',
        fromId: myId,
        isScreenSharing: false,
      });
    }
  }, [participants.length, myId, joined, send]);

  // Poll audio levels from AudioManager for VU meter display
  useEffect(() => {
    const interval = setInterval(() => {
      const am = audioManagerRef.current;
      if (!am) return;
      setAudioLevels(am.getAllAudioLevels());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Poll WebRTC connection stats every 2 seconds
  useEffect(() => {
    let prev: PrevStatsEntry | null = null;
    const peerPrevStats = new Map<string, PeerPrevStats>();

    const poll = async () => {
      const pm = peerManagerRef.current;
      if (!pm) return;

      const peerIds = pm.getAllPeerIds();
      if (peerIds.length === 0) {
        setConnectionStats(null);
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
            if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
              totalAudioBytesSent += stat.bytesSent ?? 0;
            }
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
              const bytes = stat.bytesReceived ?? 0;
              totalAudioBytesRecv += bytes;
              peerRecv += bytes;
              totalPacketsRecv += stat.packetsReceived ?? 0;
              totalPacketsLost += stat.packetsLost ?? 0;
              if (stat.jitter != null) {
                jitterSec = stat.jitter;
              }
            }
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              if (stat.currentRoundTripTime != null) {
                rttSum += stat.currentRoundTripTime * 1000;
                rttCount++;
                peerRttSum += stat.currentRoundTripTime * 1000;
                peerRttCount++;
              }
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

        // Estimated one-way latency: RTT/2 + jitter buffer estimate + processing overhead
        if (peerRttCount > 0) {
          const peerRttMs = peerRttSum / peerRttCount;
          const jitterMs = jitterSec * 1000;
          peerLatencyMs[peerId] = Math.round(peerRttMs / 2 + Math.max(jitterMs * 2, 20) + 20);
        }
      }

      const now = Date.now();
      const peerRecvBitrateKbps: Record<string, number> = {};

      if (prev) {
        const timeDelta = (now - prev.timestamp) / 1000;
        if (timeDelta > 0) {
          const sendBitrate = ((totalAudioBytesSent - prev.audioBytesSent) * 8) / timeDelta / 1000;
          const recvBitrate = ((totalAudioBytesRecv - prev.audioBytesRecv) * 8) / timeDelta / 1000;
          const newPacketsRecv = totalPacketsRecv - prev.packetsRecv;
          const newPacketsLost = totalPacketsLost - prev.packetsLost;
          const totalNew = newPacketsRecv + newPacketsLost;

          // Compute per-peer recv bitrate
          for (const peerId of peerIds) {
            const prevPeer = peerPrevStats.get(peerId);
            if (prevPeer) {
              const peerTimeDelta = (now - prevPeer.timestamp) / 1000;
              if (peerTimeDelta > 0) {
                const peerBitrate = ((peerBytesRecv[peerId] - prevPeer.bytesRecv) * 8) / peerTimeDelta / 1000;
                peerRecvBitrateKbps[peerId] = Math.max(0, Math.round(peerBitrate));
              }
            }
          }

          const stats: ConnectionStats = {
            sendBitrateKbps: Math.max(0, Math.round(sendBitrate)),
            recvBitrateKbps: Math.max(0, Math.round(recvBitrate)),
            rttMs: rttCount > 0 ? Math.round(rttSum / rttCount) : 0,
            packetLossPercent: totalNew > 0 ? Math.round((newPacketsLost / totalNew) * 1000) / 10 : 0,
            peerRecvBitrateKbps,
            peerLatencyMs,
          };

          setConnectionStats(stats);

          if (debugModeRef.current) {
            addDebugEvent(
              `Stats: ↑${stats.sendBitrateKbps}k ↓${stats.recvBitrateKbps}k RTT:${stats.rttMs}ms Loss:${stats.packetLossPercent}%`,
            );
          }
        }
      }

      // Update per-peer prev stats
      for (const peerId of peerIds) {
        peerPrevStats.set(peerId, { bytesRecv: peerBytesRecv[peerId] ?? 0, timestamp: now });
      }
      // Clean up stale peers
      for (const peerId of peerPrevStats.keys()) {
        if (!peerIds.includes(peerId)) {
          peerPrevStats.delete(peerId);
        }
      }

      prev = {
        audioBytesSent: totalAudioBytesSent,
        audioBytesRecv: totalAudioBytesRecv,
        packetsRecv: totalPacketsRecv,
        packetsLost: totalPacketsLost,
        timestamp: now,
      };
    };

    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [addDebugEvent]);

  return {
    connected,
    joined,
    myId,
    participants,
    chatMessages,
    remoteMuteStates,
    remoteVideoMuteStates,
    remoteScreenShareStates,
    speakingStates,
    audioLevels,
    peerVolumes,
    connectionStats,
    roomEvents,
    joinedAt,
    isMuted,
    isVideoMuted,
    videoEnabled,
    overlayEnabled,
    error,
    debugMode,
    sendMessage,
    toggleMute,
    toggleVideo,
    toggleOverlay,
    peerVideoOpen,
    togglePeerVideo,
    setPeerVolume,
    updateDevices,
    toggleDebug,
    leave,
  };
}
