import type { ChatMessage } from '@openmeet/shared';
import { Paperclip, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendText: (content: string) => void;
  onSendFile: (file: File) => void;
  onClose?: () => void;
}

const MIN_WIDTH = 320; // md:w-80 = 20rem = 320px

export function ChatPanel({ messages, onSendText, onSendFile, onClose }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [width, setWidth] = useState(MIN_WIDTH);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragging = useRef(false);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startX - ev.clientX;
        const maxWidth = window.innerWidth * 0.6;
        setWidth(Math.max(MIN_WIDTH, Math.min(startWidth + delta, maxWidth)));
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width],
  );

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
    <div
      className="fixed inset-0 z-50 flex flex-col bg-card md:relative md:inset-auto md:z-auto md:border-l md:shrink-0 md:w-[var(--chat-width)]"
      style={{ '--chat-width': `${width}px` } as React.CSSProperties}
    >
      {/* Resize drag handle */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for resizing */}
      <div
        className="hidden md:flex absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 items-center justify-center group"
        onMouseDown={onDragStart}
      >
        <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
      </div>
      <div className="h-12 px-3 font-semibold border-b flex items-center justify-between">
        <span>Chat</span>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div className="flex items-baseline gap-2 px-1">
                <span className="font-medium text-sm">{msg.username}</span>
                <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
              </div>

              <div className="rounded-lg bg-muted/50 border px-3 py-2">
                {msg.contentType === 'text' && (
                  <div className="text-sm break-words prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-0 prose-blockquote:my-1 prose-headings:my-1">
                    <Markdown
                      components={{
                        code({ className, children, ...props }) {
                          const isBlock = className?.includes('language-');
                          if (isBlock) {
                            return (
                              <code className={`${className ?? ''} text-xs`} {...props}>
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code
                              className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },
                        pre({ children }) {
                          return <pre className="rounded-md bg-muted p-3 overflow-x-auto text-xs">{children}</pre>;
                        },
                      }}
                    >
                      {msg.content}
                    </Markdown>
                  </div>
                )}

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
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="min-h-14 px-3 py-2 flex items-end gap-2 border-t">
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
        <Button variant="ghost" size="icon" className="shrink-0 mb-0.5" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Markdown..."
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none border rounded-md px-3 py-2 overflow-y-auto"
          style={{ fieldSizing: 'content', maxHeight: '15lh' }}
        />
        <Button size="icon" className="shrink-0 mb-0.5" onClick={handleSend}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
