import { Fragment, useEffect, useState } from 'react';
import type { RemoteStream } from '@/hooks/use-webrtc';
import { VideoTile } from './video-tile';

interface VideoGridProps {
  localWebcamStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteStreams: RemoteStream[];
  username: string;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isAudioMuted: boolean;
  showDebug: boolean;
  getConnection?: (peerId: string) => RTCPeerConnection | undefined;
  remoteMuteStates?: Record<string, boolean>;
  remoteScreenShareStates?: Record<string, boolean>;
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
  localWebcamStream,
  localScreenStream,
  remoteStreams,
  username,
  isVideoEnabled,
  isScreenSharing,
  isAudioMuted,
  showDebug,
  getConnection,
  remoteMuteStates = {},
  remoteScreenShareStates = {},
}: VideoGridProps) {
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const portrait = useIsPortrait();

  // Auto-spotlight when a screen share starts
  useEffect(() => {
    if (isScreenSharing) {
      setSpotlightId('local-screen');
      return;
    }
    for (const [peerId, sharing] of Object.entries(remoteScreenShareStates)) {
      if (sharing) {
        setSpotlightId(`screen-${peerId}`);
        return;
      }
    }
    // If current spotlight is a screen share that ended, clear it
    setSpotlightId((prev) => {
      if (!prev) return null;
      if (prev === 'local-screen' && !isScreenSharing) return null;
      if (prev.startsWith('screen-')) {
        const peerId = prev.replace('screen-', '');
        if (!remoteScreenShareStates[peerId]) return null;
      }
      return prev;
    });
  }, [isScreenSharing, remoteScreenShareStates]);

  // Build the list of all tiles
  // Each remote peer with screen share gets 2 tiles: webcam + screen
  // Count total tiles for grid sizing
  let tileCount = 1; // local webcam
  if (isScreenSharing) tileCount++; // local screen share
  for (const rs of remoteStreams) {
    tileCount++; // webcam tile
    if (remoteScreenShareStates[rs.peerId]) tileCount++; // screen tile
  }

  const localPeerConnection = remoteStreams.length > 0 ? getConnection?.(remoteStreams[0].peerId) : undefined;

  const toggleSpotlight = (id: string) => {
    setSpotlightId((prev) => (prev === id ? null : id));
  };

  // Spotlight mode
  if (spotlightId) {
    const sidebarDirection = portrait ? 'flex-col' : 'flex-row';
    const sidebarSize = portrait ? 'h-28' : 'w-48 min-w-[12rem]';
    const thumbDirection = portrait ? 'flex-row' : 'flex-col';
    const thumbSize = portrait ? 'w-36 h-full' : 'aspect-video';

    const renderSpotlightMain = () => {
      if (spotlightId === 'local-screen') {
        return (
          <VideoTile
            stream={localScreenStream}
            username={username}
            muted
            isVideoEnabled
            isLocal
            isAudioMuted={isAudioMuted}
            isScreenShare
            isPresenting
            showDebug={showDebug}
            peerConnection={localPeerConnection}
            onClick={() => setSpotlightId(null)}
            isSpotlight
          />
        );
      }

      if (spotlightId.startsWith('screen-')) {
        const peerId = spotlightId.replace('screen-', '');
        const remote = remoteStreams.find((s) => s.peerId === peerId);
        if (remote) {
          return (
            <VideoTile
              stream={remote.screenStream}
              username={remote.username}
              isAudioMuted={remoteMuteStates[peerId]}
              peerConnection={getConnection?.(peerId)}
              showDebug={showDebug}
              isScreenShare
              onClick={() => setSpotlightId(null)}
              isSpotlight
            />
          );
        }
      }

      if (spotlightId === 'local') {
        return (
          <VideoTile
            stream={localWebcamStream}
            username={username}
            muted
            isVideoEnabled={isVideoEnabled}
            isLocal
            isAudioMuted={isAudioMuted}
            showDebug={showDebug}
            peerConnection={localPeerConnection}
            onClick={() => setSpotlightId(null)}
            isSpotlight
          />
        );
      }

      const spotlightRemote = remoteStreams.find((s) => s.peerId === spotlightId);
      if (spotlightRemote) {
        return (
          <VideoTile
            stream={spotlightRemote.webcamStream}
            username={spotlightRemote.username}
            isAudioMuted={remoteMuteStates[spotlightRemote.peerId]}
            peerConnection={getConnection?.(spotlightRemote.peerId)}
            showDebug={showDebug}
            onClick={() => setSpotlightId(null)}
            isSpotlight
          />
        );
      }

      // Spotlight target no longer exists
      setSpotlightId(null);
      return null;
    };

    return (
      <div className={`flex-1 min-h-0 flex ${sidebarDirection} gap-2 p-2`}>
        {/* Main spotlight */}
        <div className="flex-1 min-w-0 min-h-0">{renderSpotlightMain()}</div>
        {/* Sidebar thumbnails */}
        {tileCount > 1 && (
          <div className={`flex ${thumbDirection} gap-2 ${sidebarSize} overflow-auto`}>
            {/* Local webcam thumbnail (when not in spotlight) */}
            {spotlightId !== 'local' && (
              <div className={thumbSize}>
                <VideoTile
                  stream={localWebcamStream}
                  username={username}
                  muted
                  isVideoEnabled={isVideoEnabled}
                  isLocal
                  isAudioMuted={isAudioMuted}
                  showDebug={showDebug}
                  peerConnection={localPeerConnection}
                />
              </div>
            )}
            {/* Local screen share thumbnail (when not in spotlight) */}
            {isScreenSharing && spotlightId !== 'local-screen' && (
              <div className={thumbSize}>
                <VideoTile
                  stream={localScreenStream}
                  username={username}
                  muted
                  isVideoEnabled
                  isLocal
                  isScreenShare
                  isPresenting
                  showDebug={showDebug}
                  peerConnection={localPeerConnection}
                  onClick={() => toggleSpotlight('local-screen')}
                />
              </div>
            )}
            {/* Remote webcam thumbnails */}
            {remoteStreams
              .filter((s) => s.peerId !== spotlightId)
              .map(({ peerId, username: peerUsername, webcamStream }) => (
                <div key={peerId} className={thumbSize}>
                  <VideoTile
                    stream={webcamStream}
                    username={peerUsername}
                    isAudioMuted={remoteMuteStates[peerId]}
                    peerConnection={getConnection?.(peerId)}
                    showDebug={showDebug}
                  />
                </div>
              ))}
            {/* Remote screen share thumbnails (when not in spotlight) */}
            {remoteStreams
              .filter((s) => remoteScreenShareStates[s.peerId] && spotlightId !== `screen-${s.peerId}`)
              .map(({ peerId, username: peerUsername, screenStream }) => (
                <div key={`screen-${peerId}`} className={thumbSize}>
                  <VideoTile
                    stream={screenStream}
                    username={`${peerUsername}'s screen`}
                    isScreenShare
                    peerConnection={getConnection?.(peerId)}
                    showDebug={showDebug}
                    onClick={() => toggleSpotlight(`screen-${peerId}`)}
                  />
                </div>
              ))}
          </div>
        )}
      </div>
    );
  }

  // Normal grid mode
  const gridClass = getGridClass(tileCount, portrait);

  return (
    <div className={`flex-1 min-h-0 grid ${gridClass} gap-2 p-2 overflow-hidden`}>
      {/* Local webcam tile */}
      <VideoTile
        stream={localWebcamStream}
        username={username}
        muted
        isVideoEnabled={isVideoEnabled}
        isLocal
        isAudioMuted={isAudioMuted}
        showDebug={showDebug}
        peerConnection={localPeerConnection}
      />
      {/* Local screen share tile */}
      {isScreenSharing && (
        <VideoTile
          stream={localScreenStream}
          username={username}
          muted
          isVideoEnabled
          isLocal
          isScreenShare
          isPresenting
          isAudioMuted={isAudioMuted}
          showDebug={showDebug}
          peerConnection={localPeerConnection}
          onClick={() => toggleSpotlight('local-screen')}
        />
      )}
      {/* Remote tiles */}
      {remoteStreams.map(({ peerId, username: peerUsername, webcamStream, screenStream }) => (
        <Fragment key={peerId}>
          <VideoTile
            stream={webcamStream}
            username={peerUsername}
            isAudioMuted={remoteMuteStates[peerId]}
            peerConnection={getConnection?.(peerId)}
            showDebug={showDebug}
          />
          {remoteScreenShareStates[peerId] && (
            <VideoTile
              stream={screenStream}
              username={`${peerUsername}'s screen`}
              isScreenShare
              peerConnection={getConnection?.(peerId)}
              showDebug={showDebug}
              onClick={() => toggleSpotlight(`screen-${peerId}`)}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
