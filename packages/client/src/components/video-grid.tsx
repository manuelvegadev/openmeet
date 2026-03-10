import { useEffect, useState } from 'react';
import type { RemoteStream } from '@/hooks/use-webrtc';
import { VideoTile } from './video-tile';

interface VideoGridProps {
  localStream: MediaStream | null;
  remoteStreams: RemoteStream[];
  username: string;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isAudioMuted: boolean;
  showDebug: boolean;
  getConnection?: (peerId: string) => RTCPeerConnection | undefined;
  remoteMuteStates?: Record<string, boolean>;
}

function useIsPortrait() {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const onChange = (e: MediaQueryListEvent) => setPortrait(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return portrait;
}

function getGridClass(count: number, portrait: boolean): string {
  if (count === 1) return 'grid-cols-1 grid-rows-1';
  if (count === 2) return portrait ? 'grid-cols-1 grid-rows-2' : 'grid-cols-2 grid-rows-1';
  if (count <= 4) return portrait ? 'grid-cols-1 grid-rows-[repeat(auto-fill,1fr)]' : 'grid-cols-2 auto-rows-fr';
  return portrait ? 'grid-cols-2 auto-rows-fr' : 'grid-cols-3 auto-rows-fr';
}

export function VideoGrid({
  localStream,
  remoteStreams,
  username,
  isVideoEnabled,
  isScreenSharing,
  isAudioMuted,
  showDebug,
  getConnection,
  remoteMuteStates = {},
}: VideoGridProps) {
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const portrait = useIsPortrait();

  const totalParticipants = 1 + remoteStreams.length;
  const localPeerConnection = remoteStreams.length > 0 ? getConnection?.(remoteStreams[0].peerId) : undefined;

  const toggleSpotlight = (id: string) => {
    setSpotlightId((prev) => (prev === id ? null : id));
  };

  // Spotlight mode
  if (spotlightId) {
    const isLocalSpotlight = spotlightId === 'local';
    const spotlightRemote = remoteStreams.find((s) => s.peerId === spotlightId);

    if (!isLocalSpotlight && !spotlightRemote) {
      setSpotlightId(null);
      return null;
    }

    const sidebarDirection = portrait ? 'flex-col' : 'flex-row';
    const sidebarSize = portrait ? 'h-28' : 'w-48 min-w-[12rem]';
    const thumbDirection = portrait ? 'flex-row' : 'flex-col';
    const thumbSize = portrait ? 'w-36 h-full' : 'aspect-video';

    return (
      <div className={`flex-1 min-h-0 flex ${sidebarDirection} gap-2 p-2`}>
        {/* Main spotlight */}
        <div className="flex-1 min-w-0 min-h-0">
          {isLocalSpotlight ? (
            <VideoTile
              stream={localStream}
              username={username}
              muted
              isVideoEnabled={isVideoEnabled}
              isLocal
              isAudioMuted={isAudioMuted}
              isScreenShare={isScreenSharing}
              showDebug={showDebug}
              peerConnection={localPeerConnection}
              onClick={() => setSpotlightId(null)}
              isSpotlight
            />
          ) : spotlightRemote ? (
            <VideoTile
              stream={spotlightRemote.stream}
              username={spotlightRemote.username}
              isAudioMuted={remoteMuteStates[spotlightRemote.peerId]}
              peerConnection={getConnection?.(spotlightRemote.peerId)}
              showDebug={showDebug}
              onClick={() => setSpotlightId(null)}
              isSpotlight
            />
          ) : null}
        </div>
        {/* Sidebar thumbnails */}
        {totalParticipants > 1 && (
          <div className={`flex ${thumbDirection} gap-2 ${sidebarSize}`}>
            {!isLocalSpotlight && (
              <div className={thumbSize}>
                <VideoTile
                  stream={localStream}
                  username={username}
                  muted
                  isVideoEnabled={isVideoEnabled}
                  isLocal
                  isAudioMuted={isAudioMuted}
                  isScreenShare={isScreenSharing}
                  showDebug={showDebug}
                  peerConnection={localPeerConnection}
                  onClick={() => toggleSpotlight('local')}
                />
              </div>
            )}
            {remoteStreams
              .filter((s) => s.peerId !== spotlightId)
              .map(({ peerId, username: peerUsername, stream }) => (
                <div key={peerId} className={thumbSize}>
                  <VideoTile
                    stream={stream}
                    username={peerUsername}
                    isAudioMuted={remoteMuteStates[peerId]}
                    peerConnection={getConnection?.(peerId)}
                    showDebug={showDebug}
                    onClick={() => toggleSpotlight(peerId)}
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  // Normal grid mode
  const gridClass = getGridClass(totalParticipants, portrait);

  return (
    <div className={`flex-1 min-h-0 grid ${gridClass} gap-2 p-2 overflow-hidden`}>
      <VideoTile
        stream={localStream}
        username={username}
        muted
        isVideoEnabled={isVideoEnabled}
        isLocal
        isAudioMuted={isAudioMuted}
        isScreenShare={isScreenSharing}
        showDebug={showDebug}
        peerConnection={localPeerConnection}
        onClick={() => toggleSpotlight('local')}
      />
      {remoteStreams.map(({ peerId, username: peerUsername, stream }) => (
        <VideoTile
          key={peerId}
          stream={stream}
          username={peerUsername}
          isAudioMuted={remoteMuteStates[peerId]}
          peerConnection={getConnection?.(peerId)}
          showDebug={showDebug}
          onClick={() => toggleSpotlight(peerId)}
        />
      ))}
    </div>
  );
}
