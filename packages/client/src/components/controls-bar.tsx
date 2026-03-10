import { Bug, MessageSquare, Mic, MicOff, Monitor, MonitorOff, Music, Music2, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DeviceSelector } from './device-selector';

interface ControlsBarProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isChatOpen: boolean;
  isDebugEnabled: boolean;
  isSystemAudioSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleSystemAudio: () => void;
  onToggleChat: () => void;
  onToggleDebug: () => void;
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  videoDeviceId: string;
  echoCancellation: boolean;
  onSwitchAudio: (deviceId: string) => void;
  onSwitchVideo: (deviceId: string) => void;
  onToggleEchoCancellation: () => void;
}

export function ControlsBar({
  isAudioEnabled,
  isVideoEnabled,
  isScreenSharing,
  isChatOpen,
  isDebugEnabled,
  isSystemAudioSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleSystemAudio,
  onToggleChat,
  onToggleDebug,
  audioDevices,
  videoDevices,
  audioDeviceId,
  videoDeviceId,
  echoCancellation,
  onSwitchAudio,
  onSwitchVideo,
  onToggleEchoCancellation,
}: ControlsBarProps) {
  return (
    <div className="flex items-center justify-center gap-2 p-3 bg-card border-t">
      <div className="flex items-center bg-muted rounded-lg p-1 gap-1">
        <Tooltip>
          <TooltipTrigger>
            <Button variant={isAudioEnabled ? 'outline' : 'secondary'} size="icon" onClick={onToggleAudio}>
              {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isAudioEnabled ? 'Mute' : 'Unmute'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger>
            <Button variant={isVideoEnabled ? 'outline' : 'secondary'} size="icon" onClick={onToggleVideo}>
              {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}</TooltipContent>
        </Tooltip>

        <DeviceSelector
          audioDevices={audioDevices}
          videoDevices={videoDevices}
          audioDeviceId={audioDeviceId}
          videoDeviceId={videoDeviceId}
          isAudioEnabled={isAudioEnabled}
          echoCancellation={echoCancellation}
          onSwitchAudio={onSwitchAudio}
          onSwitchVideo={onSwitchVideo}
          onToggleEchoCancellation={onToggleEchoCancellation}
        />
      </div>

      <Tooltip>
        <TooltipTrigger>
          <Button variant={isScreenSharing ? 'secondary' : 'outline'} size="icon" onClick={onToggleScreenShare}>
            {isScreenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isScreenSharing ? 'Stop sharing' : 'Share screen'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger>
          <Button variant={isSystemAudioSharing ? 'secondary' : 'outline'} size="icon" onClick={onToggleSystemAudio}>
            {isSystemAudioSharing ? <Music2 className="h-5 w-5" /> : <Music className="h-5 w-5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isSystemAudioSharing ? 'Stop sharing audio' : 'Share system audio'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger>
          <Button variant={isChatOpen ? 'secondary' : 'outline'} size="icon" onClick={onToggleChat}>
            <MessageSquare className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Chat</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger>
          <Button variant={isDebugEnabled ? 'secondary' : 'outline'} size="icon" onClick={onToggleDebug}>
            <Bug className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDebugEnabled ? 'Hide debug info' : 'Show debug info'}</TooltipContent>
      </Tooltip>
    </div>
  );
}
