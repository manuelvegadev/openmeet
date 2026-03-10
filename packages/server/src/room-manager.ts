import type { Participant, Room } from '@openmeet/shared';
import { nanoid } from 'nanoid';
import { getDb } from './db.js';

export function createRoom(name: string, id?: string): Room {
  const db = getDb();
  const roomId = id ?? nanoid(10);
  db.prepare('INSERT INTO rooms (id, name) VALUES (?, ?)').run(roomId, name);
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as {
    id: string;
    name: string;
    created_at: string;
  };
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export function getRoom(id: string): Room | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as
    | { id: string; name: string; created_at: string }
    | undefined;
  if (!row) return undefined;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export function listRooms(): Room[] {
  const db = getDb();
  const rows = db
    .prepare(`
    SELECT r.id, r.name, r.created_at, COUNT(p.id) as participant_count
    FROM rooms r
    LEFT JOIN participants p ON p.room_id = r.id
    GROUP BY r.id
  `)
    .all() as Array<{ id: string; name: string; created_at: string; participant_count: number }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    participantCount: row.participant_count,
  }));
}

export function addParticipant(roomId: string, username: string): Participant {
  const db = getDb();
  const id = nanoid(12);
  db.prepare('INSERT INTO participants (id, room_id, username) VALUES (?, ?, ?)').run(id, roomId, username);
  const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as {
    id: string;
    room_id: string;
    username: string;
    joined_at: string;
  };
  return { id: row.id, username: row.username, joinedAt: row.joined_at };
}

export function removeParticipant(participantId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM participants WHERE id = ?').run(participantId);
}

export function getParticipants(roomId: string): Participant[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM participants WHERE room_id = ?').all(roomId) as Array<{
    id: string;
    username: string;
    joined_at: string;
  }>;
  return rows.map((row) => ({ id: row.id, username: row.username, joinedAt: row.joined_at }));
}

export function getParticipantCount(roomId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM participants WHERE room_id = ?').get(roomId) as {
    count: number;
  };
  return row.count;
}

export function cleanEmptyRooms(): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM rooms WHERE id NOT IN (
      SELECT DISTINCT room_id FROM participants
    )
  `).run();
}
