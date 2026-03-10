import type { ChatBroadcastMessage, ChatMessage } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import { WebSocket } from 'ws';
import type { ConnectedClient } from './signaling.js';

export function handleChatMessage(
  message: ChatMessage,
  sender: ConnectedClient,
  roomClients: Map<string, ConnectedClient>,
): void {
  const broadcast: ChatBroadcastMessage = {
    type: 'chat-broadcast',
    message: {
      ...message,
      id: nanoid(),
      username: sender.username,
      timestamp: Date.now(),
    },
  };

  const data = JSON.stringify(broadcast);
  for (const [, client] of roomClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}
