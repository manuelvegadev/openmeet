import type { ChatMessage, WSMessage } from '@openmeet/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChatPanel } from '@/components/chat-panel';
import { ControlsBar } from '@/components/controls-bar';
import { PreJoinLobby } from '@/components/pre-join-lobby';
import { TopBar } from '@/components/top-bar';
import { VideoGrid } from '@/components/video-grid';
import { useMedia } from '@/hooks/use-media';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useWebSocket } from '@/hooks/use-websocket';
import { getOrCreateEmoji } from '@/lib/utils';

export const Route = createFileRoute('/room/$roomId')({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const [username] = useState(() => getOrCreateEmoji());
  const [readyToJoin, setReadyToJoin] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isDebugEnabled, setIsDebugEnabled] = useState(false);
  const [joined, setJoined] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [remoteMuteStates, setRemoteMuteStates] = useState<Record<string, boolean>>({});
  const [remoteVideoMuteStates, setRemoteVideoMuteStates] = useState<Record<string, boolean>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const isChatOpenRef = useRef(isChatOpen);
  isChatOpenRef.current = isChatOpen;

  const media = useMedia();

  // Use a ref-based send to avoid circular deps
  const sendRef = useRef<(msg: WSMessage) => void>(() => {});

  const wrappedSend = useCallback((msg: WSMessage) => {
    sendRef.current(msg);
  }, []);

  const webrtc = useWebRTC(wrappedSend, media.stream, media.screenStream);

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.type) {
        case 'room-joined':
          setJoined(true);
          setMyId(msg.yourId);
          break;
        case 'participant-joined':
          toast(`${msg.participant.username} joined`);
          break;
        case 'participant-left':
          toast('A participant left');
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
          break;
        case 'mute-state':
          setRemoteMuteStates((prev) => ({ ...prev, [msg.fromId]: msg.isAudioMuted }));
          if (msg.isVideoMuted !== undefined) {
            setRemoteVideoMuteStates((prev) => ({ ...prev, [msg.fromId]: msg.isVideoMuted as boolean }));
          }
          break;
        case 'chat-broadcast':
          setChatMessages((prev) => [...prev, msg.message]);
          if (!isChatOpenRef.current) {
            setUnreadCount((prev) => prev + 1);
          }
          break;
        case 'error':
          toast.error(msg.message);
          break;
      }

      webrtc.handleSignalingMessage(msg);
    },
    [webrtc.handleSignalingMessage],
  );

  const { send, connected } = useWebSocket(handleMessage);

  // Keep sendRef in sync
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount only
  useEffect(() => {
    media.startMedia();
    return () => {
      media.stopMedia();
    };
  }, []);

  // Reset joined state when connection drops so we re-join on reconnect
  useEffect(() => {
    if (!connected) {
      setJoined(false);
    }
  }, [connected]);

  // Join room when connected and user has clicked "Join now"
  useEffect(() => {
    if (connected && username && readyToJoin && !joined) {
      send({ type: 'join-room', roomId, username });
    }
  }, [connected, username, roomId, send, joined, readyToJoin]);

  // Broadcast mute state: after joining, on audio/video toggle, and when
  // participants change (so newcomers learn our state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: participants.length is an intentional trigger
  useEffect(() => {
    if (myId && joined) {
      send({
        type: 'mute-state',
        fromId: myId,
        isAudioMuted: !media.isAudioEnabled,
        isVideoMuted: !media.isVideoEnabled,
      });
    }
  }, [media.isAudioEnabled, media.isVideoEnabled, myId, joined, send, webrtc.participants.length]);

  // Broadcast screen share state: after joining, on screen share toggle, and when
  // participants change (so newcomers learn our state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: participants.length is an intentional trigger
  useEffect(() => {
    if (myId && joined) {
      send({ type: 'screen-share-state', fromId: myId, isScreenSharing: media.isScreenSharing });
    }
  }, [media.isScreenSharing, myId, joined, send, webrtc.participants.length]);

  const handleToggleScreenShare = useCallback(async () => {
    if (media.isScreenSharing) {
      media.stopScreenShare();
    } else {
      await media.startScreenShare();
    }
  }, [media.isScreenSharing, media.stopScreenShare, media.startScreenShare]);

  const handleToggleSystemAudio = useCallback(async () => {
    if (media.isSystemAudioSharing) {
      media.stopSystemAudio();
    } else {
      await media.startSystemAudio();
    }
  }, [media.isSystemAudioSharing, media.stopSystemAudio, media.startSystemAudio]);

  const handleLeave = useCallback(() => {
    media.stopMedia();
    navigate({ to: '/' });
  }, [media.stopMedia, navigate]);

  const handleSendText = useCallback(
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

  const handleSendFile = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('roomId', roomId);

      try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Upload failed');
        const { url, originalName } = await response.json();

        const contentType = file.type.startsWith('image/') ? ('image' as const) : ('file' as const);
        send({
          type: 'chat-message',
          id: '',
          roomId,
          username,
          content: contentType === 'image' ? 'shared an image' : `shared a file: ${originalName}`,
          contentType,
          fileUrl: url,
          fileName: originalName,
          timestamp: 0,
        });
      } catch (err) {
        console.error('File upload failed:', err);
        toast.error('Failed to upload file');
      }
    },
    [send, roomId, username],
  );

  if (!readyToJoin) {
    return (
      <PreJoinLobby
        username={username}
        stream={media.stream}
        isAudioEnabled={media.isAudioEnabled}
        isVideoEnabled={media.isVideoEnabled}
        onToggleAudio={media.toggleAudio}
        onToggleVideo={media.toggleVideo}
        onJoin={() => setReadyToJoin(true)}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <TopBar
          roomId={roomId}
          participantCount={webrtc.participants.length + 1}
          connected={connected}
          onLeave={handleLeave}
        />
        <VideoGrid
          localWebcamStream={media.stream}
          localScreenStream={media.screenStream}
          remoteStreams={webrtc.remoteStreams}
          username={username}
          isVideoEnabled={media.isVideoEnabled}
          isScreenSharing={media.isScreenSharing}
          isAudioMuted={!media.isAudioEnabled}
          showDebug={isDebugEnabled}
          getConnection={webrtc.getConnection}
          remoteMuteStates={remoteMuteStates}
          remoteVideoMuteStates={remoteVideoMuteStates}
          remoteScreenShareStates={webrtc.screenShareStates}
          audioOutputDeviceId={media.audioOutputDeviceId}
        />
        <ControlsBar
          isAudioEnabled={media.isAudioEnabled}
          isVideoEnabled={media.isVideoEnabled}
          isScreenSharing={media.isScreenSharing}
          isChatOpen={isChatOpen}
          isDebugEnabled={isDebugEnabled}
          isSystemAudioSharing={media.isSystemAudioSharing}
          onToggleAudio={media.toggleAudio}
          onToggleVideo={media.toggleVideo}
          onToggleScreenShare={handleToggleScreenShare}
          onToggleSystemAudio={handleToggleSystemAudio}
          unreadCount={unreadCount}
          onToggleChat={() => {
            setIsChatOpen((prev) => {
              if (!prev) setUnreadCount(0);
              return !prev;
            });
          }}
          onToggleDebug={() => setIsDebugEnabled((prev) => !prev)}
          audioDevices={media.audioDevices}
          videoDevices={media.videoDevices}
          audioOutputDevices={media.audioOutputDevices}
          audioDeviceId={media.audioDeviceId}
          videoDeviceId={media.videoDeviceId}
          audioOutputDeviceId={media.audioOutputDeviceId}
          echoCancellation={media.echoCancellation}
          onSwitchAudio={media.switchAudioDevice}
          onSwitchVideo={media.switchVideoDevice}
          onSwitchAudioOutput={media.switchAudioOutputDevice}
          onToggleEchoCancellation={media.toggleEchoCancellation}
          onRequestDevicePermission={media.requestDevicePermission}
        />
      </div>
      {isChatOpen && (
        <ChatPanel
          messages={chatMessages}
          onSendText={handleSendText}
          onSendFile={handleSendFile}
          onClose={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}
