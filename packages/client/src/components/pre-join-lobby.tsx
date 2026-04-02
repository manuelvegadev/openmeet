import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

interface PreJoinLobbyProps {
  username: string;
  stream: MediaStream | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onJoin: () => void;
}

export function PreJoinLobby({
  username,
  stream,
  isAudioEnabled,
  isVideoEnabled,
  onToggleAudio,
  onToggleVideo,
  onJoin,
}: PreJoinLobbyProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="flex h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        {/* Video preview */}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
          {isVideoEnabled && stream ? (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover -scale-x-100" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex size-20 items-center justify-center rounded-full bg-muted-foreground/10 text-4xl">
                {username}
              </div>
            </div>
          )}

          {/* Username badge */}
          <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs text-white">{username}</div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button variant={isAudioEnabled ? 'outline' : 'destructive'} size="icon-lg" onClick={onToggleAudio}>
            {isAudioEnabled ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
          </Button>
          <Button variant={isVideoEnabled ? 'outline' : 'destructive'} size="icon-lg" onClick={onToggleVideo}>
            {isVideoEnabled ? <VideoIcon className="size-5" /> : <VideoOffIcon className="size-5" />}
          </Button>
        </div>

        {/* Join button */}
        <Button size="lg" className="w-full max-w-xs text-base" onClick={onJoin}>
          Join now
        </Button>
      </div>
    </div>
  );
}
