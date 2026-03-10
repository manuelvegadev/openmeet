import type { ChatMessage, WSMessage } from '@openmeet/shared';
import { useCallback, useState } from 'react';

export function useChat(send: (msg: WSMessage) => void, roomId: string, username: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const handleChatBroadcast = useCallback((message: WSMessage) => {
    if (message.type === 'chat-broadcast') {
      setMessages((prev) => [...prev, message.message]);
    }
  }, []);

  const sendTextMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      send({
        type: 'chat-message',
        id: '',
        roomId,
        username,
        content: content.trim(),
        contentType: 'text',
        timestamp: 0,
      });
    },
    [send, roomId, username],
  );

  const sendFileMessage = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Upload failed');
        const { url, originalName } = await response.json();

        const contentType = file.type.startsWith('image/') ? ('image' as const) : ('file' as const);
        send({
          type: 'chat-message',
          id: '',
          roomId,
          username,
          content: contentType === 'image' ? 'shared an image' : `shared a file: ${originalName}`,
          contentType,
          fileUrl: url,
          fileName: originalName,
          timestamp: 0,
        });
      } catch (err) {
        console.error('File upload failed:', err);
      }
    },
    [send, roomId, username],
  );

  return { messages, sendTextMessage, sendFileMessage, handleChatBroadcast };
}
