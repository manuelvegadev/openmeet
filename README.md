# OpenMeet

[![npm](https://img.shields.io/npm/v/openmeet-terminal?logo=npm&color=cb3837)](https://www.npmjs.com/package/openmeet-terminal)
[![CI](https://github.com/manuelvegadev/openmeet/actions/workflows/ci.yml/badge.svg)](https://github.com/manuelvegadev/openmeet/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/openmeet-terminal?logo=node.js&logoColor=white&color=5FA04E)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/openmeet-terminal?color=blue)](#license)

Lightweight, self-hosted audio/video conferencing from the terminal. Create or join a room, talk over stereo Opus audio, share your webcam or screen, and chat — all peer-to-peer with no account required.

![OpenMeet running in a terminal: the conversation on the left, the participants with their state tags and VU meters on the right](docs/screenshot.png)

The project has two parts:

- **Server** — a small Express + WebSocket signaling server (no database, no auth)
- **Terminal client** — a TUI published to npm as [`openmeet-terminal`](packages/terminal/README.md)

## Features

- **Audio calls** — WebRTC peer-to-peer mesh (up to 6 participants), stereo Opus at 128 kbps in each direction by default, RED-protected, with optional noise suppression
- **Webcam and screen sharing** — sent via ffmpeg, received in native ffplay windows: the camera in its own aspect ratio up to 720 px tall, the screen in its own up to 1080 px on the short side (an ultrawide goes out as 2580x1080, not letterboxed)
- **Chat** — text messages alongside the call
- **Per-peer volume, VU meters and latency estimates** — see who is talking and how far away they are
- **Pick a name and a colour, once** — no sign-up; you show up as `[name]` in your colour for everyone
- **Connection recovery** — automatic retry with exponential backoff

## Architecture

```
Client A <──WebRTC P2P──> Client B
   ↑                         ↑
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
| Terminal client | Ink 7 (React for terminals), @roamhq/wrtc, audify (RtAudio), ffmpeg |
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
- ffmpeg, for the terminal client's screen sharing and webcam (optional; audio needs nothing — it talks to CoreAudio/WASAPI through a bundled native module)

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
