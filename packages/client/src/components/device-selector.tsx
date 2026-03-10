import { AudioLines, ChevronUp, Mic, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DeviceSelectorProps {
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  videoDeviceId: string;
  isAudioEnabled: boolean;
  echoCancellation: boolean;
  onSwitchAudio: (deviceId: string) => void;
  onSwitchVideo: (deviceId: string) => void;
  onToggleEchoCancellation: () => void;
}

export function DeviceSelector({
  audioDevices,
  videoDevices,
  audioDeviceId,
  videoDeviceId,
  isAudioEnabled,
  echoCancellation,
  onSwitchAudio,
  onSwitchVideo,
  onToggleEchoCancellation,
}: DeviceSelectorProps) {
  const hasAudioLabels = audioDevices.some((d) => d.label);

  return (
    <Popover>
      <PopoverTrigger>
        <Button variant="outline" size="icon" className="h-8 w-8">
          <ChevronUp className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8}>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Mic className="h-3.5 w-3.5" />
            Microphone
          </div>
          {!isAudioEnabled || !hasAudioLabels ? (
            <p className="text-xs text-muted-foreground px-2 py-1">Unmute your mic first to see available devices</p>
          ) : (
            <div className="space-y-0.5">
              {audioDevices.map((device) => (
                <button
                  type="button"
                  key={device.deviceId}
                  onClick={() => onSwitchAudio(device.deviceId)}
                  className={`w-full text-left text-sm px-2 py-1.5 rounded-md truncate transition-colors ${
                    device.deviceId === audioDeviceId ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t my-1.5" />

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <AudioLines className="h-3.5 w-3.5" />
            Audio Processing
          </div>
          <button
            type="button"
            onClick={onToggleEchoCancellation}
            className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <span>Echo Cancellation</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${echoCancellation ? 'bg-green-500/20 text-green-500' : 'bg-muted-foreground/20 text-muted-foreground'}`}
            >
              {echoCancellation ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>

        {videoDevices.length > 0 && (
          <>
            <div className="border-t my-1.5" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Video className="h-3.5 w-3.5" />
                Camera
              </div>
              <div className="space-y-0.5">
                {videoDevices.map((device) => (
                  <button
                    type="button"
                    key={device.deviceId}
                    onClick={() => onSwitchVideo(device.deviceId)}
                    className={`w-full text-left text-sm px-2 py-1.5 rounded-md truncate transition-colors ${
                      device.deviceId === videoDeviceId ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
