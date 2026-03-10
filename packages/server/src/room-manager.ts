import fs from 'node:fs';
import path from 'node:path';
import type { Participant, Room } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import type { ConnectedClient } from './types.js';

export interface RoomState {
  name: string;
  createdAt: string;
  clients: Map<string, ConnectedClient>;
  uploadedFiles: string[]; // filenames (not full paths)
}

const rooms = new Map<string, RoomState>();

export function createRoom(name: string, id?: string): Room {
  const roomId = id ?? nanoid(10);
  const createdAt = new Date().toISOString();
  rooms.set(roomId, { name, createdAt, clients: new Map(), uploadedFiles: [] });
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
    room = { name: name ?? id, createdAt: new Date().toISOString(), clients: new Map(), uploadedFiles: [] };
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
    // Delete all uploaded files for this room
    for (const filename of room.uploadedFiles) {
      const filePath = path.join(config.uploadDir, filename);
      fs.unlink(filePath, () => {});
    }
    rooms.delete(roomId);
  }
}

export function addRoomUpload(roomId: string, filename: string): void {
  const room = rooms.get(roomId);
  if (room) {
    room.uploadedFiles.push(filename);
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
