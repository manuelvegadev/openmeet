import type { Server } from 'node:http';
import type { WSMessage } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import { WebSocket, WebSocketServer } from 'ws';
import { handleChatMessage } from './chat.js';
import { config } from './config.js';
import { addParticipant, ensureRoom, getParticipants, getRoomState, removeParticipant } from './room-manager.js';
import type { ConnectedClient } from './types.js';

export function setupSignaling(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  console.log('WebSocket server listening on path /ws');

  // Ping all clients every 25s to keep connections alive through reverse proxies
  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }
  }, 25_000);

  wss.on('close', () => clearInterval(pingInterval));

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    let client: ConnectedClient | null = null;

    ws.on('message', (raw) => {
      try {
        const message: WSMessage = JSON.parse(raw.toString());

        switch (message.type) {
          case 'join-room': {
            console.log(`join-room: roomId=${message.roomId}, username=${message.username}`);
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

            const otherParticipants = participants.filter((p) => p.id !== participantId);
            console.log(
              `room-joined: ${participantId} joined ${message.roomId}, ${otherParticipants.length} existing participants`,
            );

            ws.send(
              JSON.stringify({
                type: 'room-joined',
                roomId: message.roomId,
                yourId: participantId,
                participants: otherParticipants,
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

          case 'mute-state':
          case 'screen-share-state': {
            if (!client) return;
            const room = getRoomState(client.roomId);
            if (!room) return;
            const broadcastMsg = JSON.stringify(message);
            for (const [id, c] of room.clients) {
              if (id !== client.participantId && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(broadcastMsg);
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
      console.log(`WebSocket closed: ${client?.participantId ?? 'unknown'} in room ${client?.roomId ?? 'unknown'}`);
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
