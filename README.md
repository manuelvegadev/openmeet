# OpenMeet

Lightweight, self-hosted audio/video conferencing from the terminal. Create or join a room, talk over stereo Opus audio, share your webcam or screen, and chat — all peer-to-peer with no account required.

The project has two parts:

- **Server** — a small Express + WebSocket signaling server (no database, no auth)
- **Terminal client** — a TUI published to npm as [`openmeet-terminal`](packages/terminal/README.md)

## Features

- **Audio calls** — WebRTC peer-to-peer mesh (up to 6 participants), stereo Opus at 256kbps
- **Webcam and screen sharing** — 1080p video sent via ffmpeg, received in native ffplay windows
- **Chat** — text messages alongside the call
- **Per-peer volume, VU meters and latency estimates** — see who is talking and how far away they are
- **Emoji identities** — random emoji usernames, no sign-up
- **Connection recovery** — automatic retry with exponential backoff

## Architecture

```
Client A <──WebRTC P2P──> Client B
   ↑                        ↑
   │   WebSocket (signaling) │
   └──────> Server <─────────┘
              │
        In-memory Maps
```

- **Signaling** — WebSocket server relays SDP offers/answers and ICE candidates
- **Media** — direct P2P connections between clients (no SFU/MCU)
- **Storage** — in-memory Maps for rooms and participants (ephemeral by design)

See [docs/websocket-webrtc-architecture.md](docs/websocket-webrtc-architecture.md) for the full signaling and WebRTC flow.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Express 5, ws (WebSocket), Node.js 22 |
| Terminal client | Ink 5 (React for terminals), @roamhq/wrtc, sox, ffmpeg |
| Shared types | TypeScript |
| Monorepo | pnpm workspaces |
| Lint/format | Biome |
| Containerization | Docker (multi-stage Alpine build) |

## Project Structure

```
openmeet/
├── packages/
│   ├── shared/          # TypeScript types (WebSocket messages, Room, Participant)
│   ├── server/          # Express + WebSocket signaling + chat
│   └── terminal/        # openmeet-terminal TUI client (npm package)
├── Dockerfile
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Development

### Prerequisites

- Node.js >= 22
- pnpm (`corepack enable`)
- sox (audio) and ffmpeg (video, optional) for the terminal client

### Setup

```bash
# Install dependencies
pnpm install

# Start the server on :3001 (and the shared package in watch mode)
pnpm dev

# Run the terminal client against the local server
pnpm --filter openmeet-terminal dev
```

### Building

```bash
pnpm build
```

Builds all packages in order: shared → server → terminal.

## Deployment

### Docker

```bash
# Build and run
docker compose up --build

# Or build the image directly
docker build -t openmeet .
docker run -p 3001:3001 openmeet
```

The production container runs the signaling server on port **3001**.

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

## Network Notes

- Uses Google STUN servers for NAT traversal
- Works on the same LAN or when at least one peer has a public IP
- For calls across restrictive NATs, you'll need a TURN server (not included)

## License

MIT
