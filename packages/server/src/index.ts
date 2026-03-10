import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { initDb } from './db.js';
import { uploadRouter } from './file-upload.js';
import { createRoom, getRoom, listRooms } from './room-manager.js';
import { setupSignaling } from './signaling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(config.uploadDir));

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

// File upload
app.use(uploadRouter);

// In production, serve the built client
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  const indexPath = path.join(clientDist, 'index.html');
  app.use(express.static(clientDist));
  // SPA fallback: serve index.html for all non-API/upload GET requests
  app.get('/', (_req, res) => {
    res.sendFile(indexPath);
  });
  app.get('{*path}', (req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Initialize database
initDb();

// Setup WebSocket signaling
setupSignaling(server);

// Start server
server.listen(config.port, () => {
  console.log(`OpenMeet server running on http://localhost:${config.port}`);
});
