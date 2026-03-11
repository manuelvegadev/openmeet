import type { ChatMessage, Participant, WSMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioManager } from '../lib/audio.js';
import type { DeviceEnvs } from '../lib/devices.js';
import { createAudioSource, PeerConnectionManager } from '../lib/webrtc.js';
import { WebSocketClient } from '../lib/websocket.js';

export interface ConnectionStats {
  sendBitrateKbps: number;
  recvBitrateKbps: number;
  rttMs: number;
  packetLossPercent: number;
}

interface PrevStatsEntry {
  audioBytesSent: number;
  audioBytesRecv: number;
  packetsRecv: number;
  packetsLost: number;
  timestamp: number;
}

export interface RoomEvent {
  timestamp: number;
  message: string;
  type: 'join' | 'leave' | 'screen' | 'mute' | 'info';
}

interface UseRoomOptions {
  serverUrl: string;
  roomId: string;
  username: string;
  deviceEnvs: DeviceEnvs;
}

interface UseRoomReturn {
  connected: boolean;
  joined: boolean;
  myId: string | null;
  participants: Participant[];
  chatMessages: ChatMessage[];
  remoteMuteStates: Record<string, boolean>;
  remoteScreenShareStates: Record<string, boolean>;
  speakingStates: Record<string, boolean>;
  audioLevels: Record<string, number>;
  peerVolumes: Record<string, number>;
  connectionStats: ConnectionStats | null;
  roomEvents: RoomEvent[];
  joinedAt: number | null;
  isMuted: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  toggleMute: () => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  updateDevices: (envs: DeviceEnvs) => void;
  leave: () => void;
}

export function useRoom(options: UseRoomOptions): UseRoomReturn {
  const { serverUrl, roomId, username, deviceEnvs } = options;

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [remoteMuteStates, setRemoteMuteStates] = useState<Record<string, boolean>>({});
  const [remoteScreenShareStates, setRemoteScreenShareStates] = useState<Record<string, boolean>>({});
  const [speakingStates, setSpeakingStates] = useState<Record<string, boolean>>({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});
  const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | null>(null);
  const [roomEvents, setRoomEvents] = useState<RoomEvent[]>([]);
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addEvent = useCallback((message: string, type: RoomEvent['type']) => {
    setRoomEvents((prev) => [...prev, { timestamp: Date.now(), message, type }]);
  }, []);

  const resolveName = useCallback((peerId: string) => {
    return participantsRef.current.find((p) => p.id === peerId)?.username ?? peerId.slice(0, 6);
  }, []);

  const wsRef = useRef<WebSocketClient | null>(null);
  const peerManagerRef = useRef<PeerConnectionManager | null>(null);
  const audioManagerRef = useRef<AudioManager | null>(null);
  const myIdRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const participantsRef = useRef<Participant[]>([]);
  const remoteMuteRef = useRef<Record<string, boolean>>({});
  const remoteScreenRef = useRef<Record<string, boolean>>({});

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
          isVideoMuted: true,
        });
      }
    }
  }, [send]);

  const setPeerVolume = useCallback((peerId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    setPeerVolumes((prev) => ({ ...prev, [peerId]: clamped }));
    audioManagerRef.current?.setVolume(peerId, clamped);
  }, []);

  const updateDevices = useCallback((envs: DeviceEnvs) => {
    audioManagerRef.current?.updateDevices(envs);
  }, []);

  const leave = useCallback(() => {
    audioManagerRef.current?.shutdown();
    peerManagerRef.current?.closeAll();
    wsRef.current?.disconnect();
  }, []);

  // Main effect: connect WS, set up WebRTC + audio
  useEffect(() => {
    const ws = new WebSocketClient(serverUrl);
    wsRef.current = ws;

    const { source, track } = createAudioSource();
    const audioManager = new AudioManager(source, deviceEnvs);
    audioManager.setSpeakingCallback((id, speaking) => {
      setSpeakingStates((prev) => ({ ...prev, [id]: speaking }));
    });
    audioManagerRef.current = audioManager;

    const peerManager = new PeerConnectionManager({
      myId: '',
      audioTrack: track,
      sendSignal: (msg) => ws.send(msg),
      onRemoteAudioTrack: (peerId, remoteTrack) => {
        audioManager.addRemotePeer(peerId, remoteTrack);
      },
      onPeerDisconnected: (peerId) => {
        audioManager.removeRemotePeer(peerId);
      },
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

          // Create connections to existing participants
          for (const p of msg.participants) {
            peerManager.createConnection(p.id);
          }

          // Broadcast initial states
          ws.send({
            type: 'mute-state',
            fromId: msg.yourId,
            isAudioMuted: false,
            isVideoMuted: true,
          });
          ws.send({
            type: 'screen-share-state',
            fromId: msg.yourId,
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
          delete remoteMuteRef.current[msg.participantId];
          setRemoteMuteStates((prev) => {
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
      audioManager.shutdown();
      peerManager.closeAll();
      ws.disconnect();
    };
  }, [serverUrl, roomId, username, deviceEnvs, addEvent, resolveName]);

  // Re-broadcast mute state when participants change (so newcomers learn our state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: participants.length is an intentional trigger
  useEffect(() => {
    if (myId && joined) {
      send({
        type: 'mute-state',
        fromId: myId,
        isAudioMuted: isMuted,
        isVideoMuted: true,
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

    const poll = async () => {
      const pm = peerManagerRef.current;
      if (!pm) return;

      const peerIds = pm.getAllPeerIds();
      if (peerIds.length === 0) {
        setConnectionStats(null);
        prev = null;
        return;
      }

      let totalAudioBytesSent = 0;
      let totalAudioBytesRecv = 0;
      let totalPacketsRecv = 0;
      let totalPacketsLost = 0;
      let rttSum = 0;
      let rttCount = 0;

      for (const peerId of peerIds) {
        const pc = pm.getConnection(peerId);
        if (!pc || typeof pc.getStats !== 'function') continue;

        try {
          const report = await pc.getStats();
          const stats = report.values ? [...report.values()] : [];

          for (const stat of stats) {
            if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
              totalAudioBytesSent += stat.bytesSent ?? 0;
            }
            if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
              totalAudioBytesRecv += stat.bytesReceived ?? 0;
              totalPacketsRecv += stat.packetsReceived ?? 0;
              totalPacketsLost += stat.packetsLost ?? 0;
            }
            if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
              if (stat.currentRoundTripTime != null) {
                rttSum += stat.currentRoundTripTime * 1000;
                rttCount++;
              }
            }
            if (stat.type === 'remote-inbound-rtp' && stat.roundTripTime != null) {
              rttSum += stat.roundTripTime * 1000;
              rttCount++;
            }
          }
        } catch {
          // Connection may have closed
        }
      }

      if (prev) {
        const timeDelta = (Date.now() - prev.timestamp) / 1000;
        if (timeDelta > 0) {
          const sendBitrate = ((totalAudioBytesSent - prev.audioBytesSent) * 8) / timeDelta / 1000;
          const recvBitrate = ((totalAudioBytesRecv - prev.audioBytesRecv) * 8) / timeDelta / 1000;
          const newPacketsRecv = totalPacketsRecv - prev.packetsRecv;
          const newPacketsLost = totalPacketsLost - prev.packetsLost;
          const totalNew = newPacketsRecv + newPacketsLost;

          setConnectionStats({
            sendBitrateKbps: Math.max(0, Math.round(sendBitrate)),
            recvBitrateKbps: Math.max(0, Math.round(recvBitrate)),
            rttMs: rttCount > 0 ? Math.round(rttSum / rttCount) : 0,
            packetLossPercent: totalNew > 0 ? Math.round((newPacketsLost / totalNew) * 1000) / 10 : 0,
          });
        }
      }

      prev = {
        audioBytesSent: totalAudioBytesSent,
        audioBytesRecv: totalAudioBytesRecv,
        packetsRecv: totalPacketsRecv,
        packetsLost: totalPacketsLost,
        timestamp: Date.now(),
      };
    };

    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  return {
    connected,
    joined,
    myId,
    participants,
    chatMessages,
    remoteMuteStates,
    remoteScreenShareStates,
    speakingStates,
    audioLevels,
    peerVolumes,
    connectionStats,
    roomEvents,
    joinedAt,
    isMuted,
    error,
    sendMessage,
    toggleMute,
    setPeerVolume,
    updateDevices,
    leave,
  };
}
