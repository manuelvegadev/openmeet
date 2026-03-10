import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface RoomCodeProps {
  roomId: string;
}

export function RoomCode({ roomId }: RoomCodeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-black/60 text-white text-sm px-3 py-1.5 rounded-md">
      <span className="text-muted-foreground text-xs">Room:</span>
      <span className="font-mono font-medium">{roomId}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-white hover:bg-white/20 hover:text-white"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
