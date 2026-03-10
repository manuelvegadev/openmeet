import { Check, Copy, PhoneOff, Share2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface TopBarProps {
  roomId: string;
  participantCount: number;
  connected?: boolean;
  onLeave: () => void;
}

export function TopBar({ roomId, participantCount, connected, onLeave }: TopBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'OpenMeet Room', url });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast('Room URL copied to clipboard');
    }
  };

  return (
    <div className="h-12 flex items-center justify-between px-3 bg-card border-b">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Room:</span>
        <span className="font-mono font-medium text-sm">{roomId}</span>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy room code</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleShare}>
              <Share2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Share room URL</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
          <Users className="h-4 w-4 text-muted-foreground" />
          <Badge variant="secondary">{participantCount}</Badge>
        </div>
        <Tooltip>
          <TooltipTrigger>
            <Button variant="destructive" size="sm" onClick={onLeave} className="h-8">
              <PhoneOff className="h-4 w-4 mr-1.5" />
              Leave
            </Button>
          </TooltipTrigger>
          <TooltipContent>Leave call</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
