import type { Server } from 'node:http';
import type { WSMessage } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import { WebSocket, WebSocketServer } from 'ws';
import { handleChatMessage } from './chat.js';
import { config } from './config.js';
import { addParticipant, ensureRoom, getParticipants, getRoomState, removeParticipant } from './room-manager.js';
import type { ConnectedClient } from './types.js';

export function setupSignaling(server: Server): void {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let client: ConnectedClient | null = null;

    ws.on('message', (raw) => {
      try {
        const message: WSMessage = JSON.parse(raw.toString());

        switch (message.type) {
          case 'join-room': {
            const room = ensureRoom(message.roomId, message.roomId);

            // Check participant limit
            if (room.clients.size >= config.maxParticipantsPerRoom) {
              ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 6 participants)' }));
              return;
            }

            const participantId = nanoid(12);

            client = {
              ws,
              participantId,
              roomId: message.roomId,
              username: message.username,
            };

            const participant = addParticipant(message.roomId, message.username, client);

            // Get current participants (excluding self)
            const participants = getParticipants(message.roomId);

            ws.send(
              JSON.stringify({
                type: 'room-joined',
                roomId: message.roomId,
                yourId: participantId,
                participants: participants.filter((p) => p.id !== participantId),
              }),
            );

            // Broadcast participant-joined to others
            const joinMsg = JSON.stringify({
              type: 'participant-joined',
              participant: { id: participant.id, username: message.username, joinedAt: participant.joinedAt },
            });
            for (const [id, c] of room.clients) {
              if (id !== participantId && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(joinMsg);
              }
            }
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            if (!client) return;
            const room = getRoomState(client.roomId);
            if (!room) return;
            const target = room.clients.get(message.toId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify(message));
            }
            break;
          }

          case 'mute-state': {
            if (!client) return;
            const room = getRoomState(client.roomId);
            if (!room) return;
            const muteMsg = JSON.stringify(message);
            for (const [id, c] of room.clients) {
              if (id !== client.participantId && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(muteMsg);
              }
            }
            break;
          }

          case 'chat-message': {
            if (!client) return;
            const room = getRoomState(client.roomId);
            if (!room) return;
            handleChatMessage(message, client, room.clients);
            break;
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      if (!client) return;

      // Get room before removing so we can broadcast
      const room = getRoomState(client.roomId);

      // Remove participant (also deletes room if empty)
      removeParticipant(client.roomId, client.participantId);

      // Broadcast participant-left to remaining clients
      if (room) {
        const leaveMsg = JSON.stringify({
          type: 'participant-left',
          participantId: client.participantId,
        });
        for (const [, c] of room.clients) {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(leaveMsg);
          }
        }
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });
}
