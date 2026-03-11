import { Maximize, Mic, MicOff, Minimize, Monitor, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  isPresenting?: boolean;
  audioOutputDeviceId?: string;
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
  isPresenting,
  audioOutputDeviceId,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stats = useConnectionStats(peerConnection, isLocal ? 'outbound' : 'inbound');
  const audioLevel = useAudioLevel(stream);
  const [volume, setVolume] = useState(1);

  // Video element — always muted; used only for video display
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && !isPresenting) {
      el.srcObject = stream;
    } else {
      el.srcObject = null;
    }
  }, [stream, isPresenting]);

  // Audio element — dedicated for remote audio playback.
  // Uses track unmute listeners as fallback for browser autoplay issues.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;

    const tryPlay = () => {
      if (el.paused && el.srcObject) {
        el.play().catch(() => {});
      }
    };
    tryPlay();

    // Retry on track unmute (handles late-arriving audio in answerer path)
    const audioTracks = stream.getAudioTracks();
    for (const track of audioTracks) {
      track.addEventListener('unmute', tryPlay);
    }
    el.addEventListener('loadedmetadata', tryPlay);

    return () => {
      for (const track of audioTracks) {
        track.removeEventListener('unmute', tryPlay);
      }
      el.removeEventListener('loadedmetadata', tryPlay);
    };
  }, [stream]);

  // Volume control — syncs slider value to audio element
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  // Route audio output to selected device (on the audio element)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioOutputDeviceId || typeof el.setSinkId !== 'function') return;
    el.setSinkId(audioOutputDeviceId).catch(() => {});
  }, [audioOutputDeviceId]);

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
      className={`group relative bg-muted rounded-lg overflow-hidden flex items-center justify-center min-h-0 h-full ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      {isPresenting ? (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Monitor className="h-16 w-16" />
          <span className="text-lg font-medium">You are presenting</span>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full ${useContain ? 'object-contain' : 'object-cover'} ${!isVideoEnabled || !stream ? 'invisible' : ''} ${isLocal && !useContain ? 'scale-x-[-1]' : ''}`}
          />
          {(!isVideoEnabled || !stream) && (
            <Avatar className="w-24 h-24 sm:w-32 sm:h-32">
              <AvatarFallback className="text-5xl sm:text-7xl bg-primary text-primary-foreground">
                {username}
              </AvatarFallback>
            </Avatar>
          )}
        </>
      )}
      {/* Dedicated audio element for remote playback — never hidden, always plays */}
      {/* biome-ignore lint/a11y/useMediaCaption: live WebRTC audio, no captions available */}
      {!muted && <audio ref={audioRef} autoPlay />}
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
      {isScreenShare && isVideoEnabled && stream && !isPresenting && (
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
      {/* Per-participant volume control — remote tiles only */}
      {!muted && !isLocal && !isPresenting && stream && (
        // biome-ignore lint/a11y/noStaticElementInteractions: volume control overlay
        <div
          className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full px-2 py-1"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="text-white hover:text-white/80"
            onClick={() => setVolume((v) => (v === 0 ? 1 : 0))}
          >
            {volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            className="w-20 h-1 accent-white cursor-pointer"
          />
          <span className="text-xs text-white min-w-[2rem] text-right">{Math.round(volume * 100)}%</span>
        </div>
      )}
    </div>
  );
}
