import type { Server } from 'node:http';
import type { WSMessage } from '@openmeet/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { handleChatMessage } from './chat.js';
import { config } from './config.js';
import {
  addParticipant,
  cleanEmptyRooms,
  createRoom,
  getParticipantCount,
  getParticipants,
  getRoom,
  removeParticipant,
} from './room-manager.js';

export interface ConnectedClient {
  ws: WebSocket;
  participantId: string;
  roomId: string;
  username: string;
}

// roomId -> Map<participantId, ConnectedClient>
const rooms = new Map<string, Map<string, ConnectedClient>>();

export function setupSignaling(server: Server): void {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let client: ConnectedClient | null = null;

    ws.on('message', (raw) => {
      try {
        const message: WSMessage = JSON.parse(raw.toString());

        switch (message.type) {
          case 'join-room': {
            // Ensure room exists in DB
            let room = getRoom(message.roomId);
            if (!room) {
              room = createRoom(message.roomId, message.roomId);
            }

            // Check participant limit
            const count = getParticipantCount(message.roomId);
            if (count >= config.maxParticipantsPerRoom) {
              ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 6 participants)' }));
              return;
            }

            // Add participant to DB
            const participant = addParticipant(message.roomId, message.username);

            // Set up client tracking
            client = {
              ws,
              participantId: participant.id,
              roomId: message.roomId,
              username: message.username,
            };

            // Add to in-memory room map
            if (!rooms.has(message.roomId)) {
              rooms.set(message.roomId, new Map());
            }
            rooms.get(message.roomId)!.set(participant.id, client);

            // Get current participants (excluding self)
            const participants = getParticipants(message.roomId);

            // Send room-joined to the new client
            ws.send(
              JSON.stringify({
                type: 'room-joined',
                roomId: message.roomId,
                yourId: participant.id,
                participants: participants.filter((p) => p.id !== participant.id),
              }),
            );

            // Broadcast participant-joined to others in the room
            const roomClients = rooms.get(message.roomId)!;
            const joinMsg = JSON.stringify({
              type: 'participant-joined',
              participant: { id: participant.id, username: message.username, joinedAt: participant.joinedAt },
            });
            for (const [id, c] of roomClients) {
              if (id !== participant.id && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(joinMsg);
              }
            }
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            // Forward signaling messages directly to the target peer
            if (!client) return;
            const roomClients = rooms.get(client.roomId);
            if (!roomClients) return;

            const target = roomClients.get(message.toId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify(message));
            }
            break;
          }

          case 'mute-state': {
            // Broadcast mute state to all other room members
            if (!client) return;
            const roomClients2 = rooms.get(client.roomId);
            if (!roomClients2) return;
            const muteMsg = JSON.stringify(message);
            for (const [id, c] of roomClients2) {
              if (id !== client.participantId && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(muteMsg);
              }
            }
            break;
          }

          case 'chat-message': {
            if (!client) return;
            const roomClients = rooms.get(client.roomId);
            if (!roomClients) return;
            handleChatMessage(message, client, roomClients);
            break;
          }
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      if (!client) return;

      const roomClients = rooms.get(client.roomId);
      if (roomClients) {
        roomClients.delete(client.participantId);

        // Broadcast participant-left
        const leaveMsg = JSON.stringify({
          type: 'participant-left',
          participantId: client.participantId,
        });
        for (const [, c] of roomClients) {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(leaveMsg);
          }
        }

        // Clean up empty room from map
        if (roomClients.size === 0) {
          rooms.delete(client.roomId);
        }
      }

      // Remove from DB
      removeParticipant(client.participantId);
      cleanEmptyRooms();
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  // Periodic cleanup of stale rooms
  setInterval(() => {
    cleanEmptyRooms();
  }, 60_000);
}
