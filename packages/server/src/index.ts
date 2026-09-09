import { createServer } from 'node:http';
import express from 'express';
import { config } from './config.js';
import { createRoom, getRoom, listRooms } from './room-manager.js';
import { setupSignaling } from './signaling.js';

const app = express();
const server = createServer(app);

app.use(express.json());

// Liveness/readiness for the container healthcheck and uptime monitoring.
app.get('/health', (_req, res) => {
  const rooms = listRooms();
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    rooms: rooms.length,
    participants: rooms.reduce((total, room) => total + (room.participantCount ?? 0), 0),
  });
});

// REST API
app.get('/api/rooms', (_req, res) => {
  res.json(listRooms());
});

app.post('/api/rooms', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Room name is required' });
    return;
  }
  const room = createRoom(name.trim());
  res.status(201).json(room);
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(room);
});

// Setup WebSocket signaling
setupSignaling(server);

// Start server
server.listen(config.port, () => {
  console.log(`OpenMeet server running on http://localhost:${config.port}`);
});

// Docker/orchestrators stop containers with SIGTERM: close listeners so in-flight
// requests finish and the process does not wait for the 10 s kill timeout.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
