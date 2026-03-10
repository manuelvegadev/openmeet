import type { ChatMessage } from '@openmeet/shared';
import { Paperclip, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendText: (content: string) => void;
  onSendFile: (file: File) => void;
}

export function ChatPanel({ messages, onSendText, onSendFile }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (input.trim()) {
      onSendText(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSendFile(file);
      e.target.value = '';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="w-80 flex flex-col border-l bg-card">
      <div className="p-3 font-semibold border-b">Chat</div>

      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-sm">{msg.username}</span>
                <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
              </div>

              {msg.contentType === 'text' && <p className="text-sm break-words">{msg.content}</p>}

              {msg.contentType === 'image' && msg.fileUrl && (
                <a href={msg.fileUrl} target="_blank" rel="noreferrer">
                  <img
                    src={msg.fileUrl}
                    alt={msg.fileName ?? 'Image'}
                    className="max-w-full rounded cursor-pointer hover:opacity-90"
                  />
                </a>
              )}

              {msg.contentType === 'file' && msg.fileUrl && (
                <a
                  href={msg.fileUrl}
                  download={msg.fileName}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Paperclip className="h-3 w-3" />
                  {msg.fileName ?? 'Download file'}
                </a>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <div className="p-3 flex gap-2">
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="flex-1"
        />
        <Button size="icon" className="shrink-0" onClick={handleSend}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
