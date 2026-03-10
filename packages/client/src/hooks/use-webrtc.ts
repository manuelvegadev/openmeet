import type { Participant, WSMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PeerConnectionManager } from '@/lib/webrtc';

export interface RemoteStream {
  peerId: string;
  username: string;
  stream: MediaStream;
}

export function useWebRTC(
  send: (msg: WSMessage) => void,
  localStream: MediaStream | null,
  screenStream: MediaStream | null,
) {
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const managerRef = useRef<PeerConnectionManager | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const sendRef = useRef(send);
  const localStreamRef = useRef(localStream);
  const screenStreamRef = useRef(screenStream);

  sendRef.current = send;
  participantsRef.current = participants;
  localStreamRef.current = localStream;
  screenStreamRef.current = screenStream;

  // Clean up manager on unmount
  useEffect(() => {
    return () => {
      managerRef.current?.closeAll();
      managerRef.current = null;
    };
  }, []);

  // Update local stream on existing connections
  useEffect(() => {
    if (localStream && managerRef.current) {
      managerRef.current.setLocalStream(localStream);
    }
  }, [localStream]);

  // Handle screen share changes on existing connections
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setScreenStream(screenStream);
    }
  }, [screenStream]);

  const createManager = useCallback((myId: string) => {
    // Clean up previous manager if any
    managerRef.current?.closeAll();

    const manager = new PeerConnectionManager({
      myId,
      sendSignal: (msg) => sendRef.current(msg),
      onRemoteStream: (peerId, stream) => {
        const participant = participantsRef.current.find((p) => p.id === peerId);
        // Wrap in a new MediaStream so React sees a new reference and
        // re-runs effects (useAudioLevel, mute detection) when tracks change
        const wrappedStream = new MediaStream(stream.getTracks());
        setRemoteStreams((prev) => [
          ...prev.filter((s) => s.peerId !== peerId),
          { peerId, username: participant?.username ?? 'Unknown', stream: wrappedStream },
        ]);
      },
      onRemoteStreamRemoved: (peerId) => {
        setRemoteStreams((prev) => prev.filter((s) => s.peerId !== peerId));
      },
    });

    managerRef.current = manager;

    // Attach current streams
    if (localStreamRef.current) {
      manager.setLocalStream(localStreamRef.current);
    }
    if (screenStreamRef.current) {
      manager.setScreenStream(screenStreamRef.current);
    }

    return manager;
  }, []);

  const handleSignalingMessage = useCallback(
    (message: WSMessage) => {
      switch (message.type) {
        case 'room-joined': {
          // Create manager synchronously so it's ready immediately
          const manager = createManager(message.yourId);
          setParticipants(message.participants);

          // Newcomer creates offers to all existing participants
          for (const p of message.participants) {
            manager.createConnection(p.id);
          }
          break;
        }

        case 'participant-joined': {
          setParticipants((prev) => [...prev, message.participant]);
          // Don't create connection — the newcomer will send us an offer
          break;
        }

        case 'participant-left': {
          setParticipants((prev) => prev.filter((p) => p.id !== message.participantId));
          managerRef.current?.removeConnection(message.participantId);
          break;
        }

        case 'offer': {
          managerRef.current?.handleOffer(message.fromId, message.sdp);
          break;
        }

        case 'answer': {
          managerRef.current?.handleAnswer(message.fromId, message.sdp);
          break;
        }

        case 'ice-candidate': {
          managerRef.current?.handleIceCandidate(message.fromId, message.candidate);
          break;
        }
      }
    },
    [createManager],
  );

  const getConnection = useCallback((peerId: string) => {
    return managerRef.current?.getConnection(peerId);
  }, []);

  return { remoteStreams, participants, handleSignalingMessage, getConnection };
}
