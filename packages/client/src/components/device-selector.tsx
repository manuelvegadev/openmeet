import { AudioLines, Mic, Settings, Speaker, Video } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DeviceSelectorProps {
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  audioDeviceId: string;
  videoDeviceId: string;
  audioOutputDeviceId: string;
  echoCancellation: boolean;
  onSwitchAudio: (deviceId: string) => void;
  onSwitchVideo: (deviceId: string) => void;
  onSwitchAudioOutput: (deviceId: string) => void;
  onToggleEchoCancellation: () => void;
  onOpen: () => void;
}

type Tab = 'microphone' | 'speaker' | 'camera';

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function DeviceSelector({
  audioDevices,
  videoDevices,
  audioOutputDevices,
  audioDeviceId,
  videoDeviceId,
  audioOutputDeviceId,
  echoCancellation,
  onSwitchAudio,
  onSwitchVideo,
  onSwitchAudioOutput,
  onToggleEchoCancellation,
  onOpen,
}: DeviceSelectorProps) {
  const [tab, setTab] = useState<Tab>('microphone');
  const hasAudioLabels = audioDevices.some((d) => d.label);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <Tooltip>
        <TooltipTrigger>
          <DialogTrigger render={<Button variant="outline" size="icon" className="h-8 w-8" />}>
            <Settings className="h-4 w-4" />
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Device settings</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Device Settings</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b">
          <TabButton
            active={tab === 'microphone'}
            onClick={() => setTab('microphone')}
            icon={<Mic className="h-3.5 w-3.5" />}
            label="Microphone"
          />
          <TabButton
            active={tab === 'speaker'}
            onClick={() => setTab('speaker')}
            icon={<Speaker className="h-3.5 w-3.5" />}
            label="Speaker"
          />
          <TabButton
            active={tab === 'camera'}
            onClick={() => setTab('camera')}
            icon={<Video className="h-3.5 w-3.5" />}
            label="Camera"
          />
        </div>

        {/* Microphone tab */}
        {tab === 'microphone' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Select microphone</div>
              {!hasAudioLabels ? (
                <p className="text-xs text-muted-foreground px-2 py-1">No microphones detected</p>
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
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    echoCancellation ? 'bg-green-500/20 text-green-500' : 'bg-muted-foreground/20 text-muted-foreground'
                  }`}
                >
                  {echoCancellation ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Speaker tab */}
        {tab === 'speaker' && (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Select speaker</div>
            {audioOutputDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">No audio output devices detected</p>
            ) : (
              <div className="space-y-0.5">
                {audioOutputDevices.map((device) => (
                  <button
                    type="button"
                    key={device.deviceId}
                    onClick={() => onSwitchAudioOutput(device.deviceId)}
                    className={`w-full text-left text-sm px-2 py-1.5 rounded-md truncate transition-colors ${
                      (audioOutputDeviceId || 'default') === device.deviceId
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {device.label || `Speaker ${device.deviceId.slice(0, 5)}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Camera tab */}
        {tab === 'camera' && (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Select camera</div>
            {videoDevices.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">No cameras detected</p>
            ) : (
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
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
