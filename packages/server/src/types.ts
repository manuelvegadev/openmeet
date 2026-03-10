import type { WebSocket } from 'ws';

export interface ConnectedClient {
  ws: WebSocket;
  participantId: string;
  roomId: string;
  username: string;
}
