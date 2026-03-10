import { Maximize, Mic, MicOff, Minimize } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAudioLevel } from '@/hooks/use-audio-level';
import { useConnectionStats } from '@/hooks/use-connection-stats';

interface VideoTileProps {
  stream: MediaStream | null;
  username: string;
  muted?: boolean;
  isVideoEnabled?: boolean;
  isLocal?: boolean;
  isAudioMuted?: boolean;
  showDebug?: boolean;
  peerConnection?: RTCPeerConnection;
  onClick?: () => void;
  isSpotlight?: boolean;
  isScreenShare?: boolean;
}

export function VideoTile({
  stream,
  username,
  muted,
  isVideoEnabled = true,
  isLocal,
  isAudioMuted,
  showDebug,
  peerConnection,
  onClick,
  isSpotlight,
  isScreenShare,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stats = useConnectionStats(peerConnection, isLocal ? 'outbound' : 'inbound');
  const audioLevel = useAudioLevel(stream);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
    }
  }, [stream]);

  const isSpeaking = audioLevel > 0.05;
  const shadowSpread = isSpeaking ? Math.min(1 + audioLevel * 5, 4) : 0;
  const shadowOpacity = isSpeaking ? Math.min(0.4 + audioLevel * 1.5, 1) : 0;

  // Use explicit prop (from signaling for remote, or parent state for local).
  // Falls back to stream track check if prop not provided.
  const audioOff = isAudioMuted ?? (stream ? stream.getAudioTracks().length === 0 : true);

  const useContain = isSpotlight || isScreenShare;

  const handleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is conditionally set when onClick is provided
    <div
      ref={containerRef}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`relative bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-0 h-full ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full ${useContain ? 'object-contain' : 'object-cover'} ${!isVideoEnabled || !stream ? 'hidden' : ''} ${isLocal && !useContain ? 'scale-x-[-1]' : ''}`}
      />
      {(!isVideoEnabled || !stream) && (
        <Avatar className="w-24 h-24 sm:w-32 sm:h-32">
          <AvatarFallback className="text-5xl sm:text-7xl bg-primary text-primary-foreground">
            {username}
          </AvatarFallback>
        </Avatar>
      )}
      {/* Speaking glow overlay */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-shadow duration-150"
        style={{
          boxShadow: isSpeaking ? `inset 0 0 0 ${shadowSpread}px rgba(34, 197, 94, ${shadowOpacity})` : 'none',
        }}
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <div
          className={`flex items-center justify-center w-6 h-6 rounded-full ${audioOff ? 'bg-red-500/80' : 'bg-black/60'}`}
        >
          {audioOff ? <MicOff className="h-3.5 w-3.5 text-white" /> : <Mic className="h-3.5 w-3.5 text-white" />}
        </div>
        <div className="bg-black/60 text-white text-lg px-2 py-0.5 rounded">
          {username}
          {isLocal ? ' (You)' : ''}
        </div>
      </div>
      {/* Fullscreen button for screen share */}
      {isScreenShare && isVideoEnabled && stream && (
        <div className="absolute top-2 left-2">
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 bg-black/50 text-white hover:bg-black/70 hover:text-white"
                onClick={handleFullscreen}
              >
                {document.fullscreenElement ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fullscreen</TooltipContent>
          </Tooltip>
        </div>
      )}
      {showDebug && stats && (
        <div className="absolute top-1.5 right-1.5 bg-black/70 text-[10px] text-green-400 font-mono px-1.5 py-1 rounded leading-tight space-y-px">
          <div className="text-blue-400">{isLocal ? 'SENDING' : 'RECEIVING'}</div>
          <div>
            V: {stats.resolution} @ {stats.framerate}fps {stats.videoBitrate}kbps {stats.videoCodec}
          </div>
          <div>
            A:{' '}
            {stats.hasAudio ? (
              `${stats.audioBitrate}kbps ${stats.audioCodec} ${stats.audioSampleRate ? `${stats.audioSampleRate / 1000}kHz` : ''}`
            ) : (
              <span className="text-yellow-400">muted</span>
            )}
          </div>
          <div>
            RTT {stats.roundTripTime}ms &middot; Loss {stats.packetLoss}%
          </div>
          <div className={stats.connectionState === 'connected' ? 'text-green-400' : 'text-yellow-400'}>
            {stats.connectionState}
          </div>
        </div>
      )}
    </div>
  );
}
