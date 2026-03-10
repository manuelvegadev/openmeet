import type { Participant, Room } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import type { ConnectedClient } from './types.js';

export interface RoomState {
  name: string;
  createdAt: string;
  clients: Map<string, ConnectedClient>;
}

const rooms = new Map<string, RoomState>();

export function createRoom(name: string, id?: string): Room {
  const roomId = id ?? nanoid(10);
  const createdAt = new Date().toISOString();
  rooms.set(roomId, { name, createdAt, clients: new Map() });
  return { id: roomId, name, createdAt };
}

export function getRoom(id: string): Room | undefined {
  const room = rooms.get(id);
  if (!room) return undefined;
  return { id, name: room.name, createdAt: room.createdAt };
}

export function getRoomState(id: string): RoomState | undefined {
  return rooms.get(id);
}

export function ensureRoom(id: string, name?: string): RoomState {
  let room = rooms.get(id);
  if (!room) {
    room = { name: name ?? id, createdAt: new Date().toISOString(), clients: new Map() };
    rooms.set(id, room);
  }
  return room;
}

export function listRooms(): Room[] {
  const result: Room[] = [];
  for (const [id, room] of rooms) {
    result.push({
      id,
      name: room.name,
      createdAt: room.createdAt,
      participantCount: room.clients.size,
    });
  }
  return result;
}

export function addParticipant(roomId: string, username: string, client: ConnectedClient): Participant {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);
  room.clients.set(client.participantId, client);
  return { id: client.participantId, username, joinedAt: new Date().toISOString() };
}

export function removeParticipant(roomId: string, participantId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(participantId);
  if (room.clients.size === 0) {
    rooms.delete(roomId);
  }
}

export function getParticipants(roomId: string): Participant[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  const result: Participant[] = [];
  for (const [id, client] of room.clients) {
    result.push({ id, username: client.username, joinedAt: new Date().toISOString() });
  }
  return result;
}

export function getParticipantCount(roomId: string): number {
  return rooms.get(roomId)?.clients.size ?? 0;
}
