# OpenMeet

Lightweight, self-hosted video conferencing. Create or join a room, share your webcam, mic, screen, and chat — all peer-to-peer with no account required.

## Features

- **Video & audio calls** — WebRTC peer-to-peer mesh (up to 6 participants)
- **Screen sharing** — share your screen with fullscreen mode
- **System audio sharing** — mix mic + system audio (music, presentations) into a single stream
- **Chat** — text messages, image previews, and file sharing
- **Fun identities** — random emoji avatars (animals, fruits, funny faces) assigned per user
- **Spotlight view** — click any tile to focus it full-size (Discord-style)
- **Debug overlay** — real-time WebRTC stats (codec, bitrate, resolution, RTT, packet loss)
- **Device preferences** — camera, mic, and echo cancellation settings saved across sessions
- **Responsive layout** — adapts grid to portrait/landscape orientation
- **No sign-up** — join via room code or direct URL

## Architecture

```
Client A <──WebRTC P2P──> Client B
   ↑                        ↑
   │   WebSocket (signaling) │
   └──────> Server <─────────┘
              │
        SQLite (in-memory)
```

- **Signaling** — WebSocket server relays SDP offers/answers and ICE candidates
- **Media** — direct P2P connections between clients (no SFU/MCU)
- **Storage** — in-memory SQLite for rooms and participants (ephemeral by design)
- **Files** — uploaded to the server via HTTP, URL shared through chat

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS 4 |
| Routing | TanStack Router (file-based) |
| UI components | shadcn/ui, Lucide icons |
| Backend | Express 5, ws (WebSocket), Node.js 22 |
| Database | better-sqlite3 (in-memory) |
| File uploads | Multer |
| Monorepo | pnpm workspaces |
| Containerization | Docker (multi-stage Alpine build) |

## Project Structure

```
openmeet/
├── packages/
│   ├── shared/          # TypeScript types (WebSocket messages, Room, Participant)
│   ├── server/          # Express + WebSocket signaling + chat + file uploads
│   └── client/          # React SPA
│       └── src/
│           ├── routes/          # TanStack file-based routes
│           ├── components/      # VideoTile, VideoGrid, TopBar, ControlsBar, ChatPanel
│           ├── hooks/           # useWebSocket, useWebRTC, useMedia, useAudioLevel
│           └── lib/             # WebRTC manager, utilities
├── Dockerfile
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Development

### Prerequisites

- Node.js >= 22
- pnpm (`corepack enable`)

### Setup

```bash
# Install dependencies
pnpm install

# Start dev servers (client on :5173, server on :3001)
pnpm dev
```

The client dev server proxies `/api` and `/uploads` requests to the server at `localhost:3001`.

### Building

```bash
pnpm build
```

Builds all packages in order: shared → client → server.

## Deployment

### Docker

```bash
# Build and run
docker compose up --build

# Or build the image directly
docker build -t openmeet .
docker run -p 3001:3001 -v uploads:/app/uploads openmeet
```

The production server serves the client SPA and handles API/WebSocket on port **3001**.

### Manual

```bash
pnpm install
pnpm build
NODE_ENV=production node packages/server/dist/index.js
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | — | Set to `production` to serve the built client |

## Network Notes

- Uses Google STUN servers for NAT traversal
- Works on the same LAN or when at least one peer has a public IP
- For calls across restrictive NATs, you'll need a TURN server (not included)

## License

MIT
