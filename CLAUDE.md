# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight Google Meet-like video conferencing app. Users create/join rooms to video chat, share screens, send messages, and upload files. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory SQLite, no authentication (username stored in localStorage).

## Architecture

```
Client A <──WebRTC P2P──> Client B
   ↑                        ↑
   │   WebSocket (signaling) │
   └──────> Server <─────────┘
              │
        SQLite (in-memory)
```

- **Topology**: P2P mesh — each client connects directly to every other client
- **Signaling**: WebSocket for SDP/ICE exchange, chat messages, and mute state
- **Media**: WebRTC with stereo Opus audio (48kHz) and VP8/VP9 video (720p webcam, 1080p@60fps screen share)
- **Files**: HTTP upload to server, URL shared via WebSocket chat

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=22 |
| Package Manager | pnpm | latest (workspace monorepo) |
| Server Framework | Express | v5 |
| WebSocket | ws | v8 |
| Database | better-sqlite3 | v11+ (in-memory) |
| File Uploads | multer | v1.4 |
| IDs | nanoid | v5 |
| Frontend Framework | React | v19 |
| Routing | TanStack Router | v1 (file-based) |
| Build Tool | Vite | v7 |
| UI Components | shadcn/ui (Base UI) | v4 |
| CSS | Tailwind CSS | v4 (OKLCH color system) |
| Icons | lucide-react | latest |
| Linting/Formatting | Biome | v2.4+ |
| TypeScript | typescript | v5.7+ |

## Monorepo Structure

```
openmeet/
├── package.json              # Root workspace scripts
├── pnpm-workspace.yaml       # packages/*
├── .npmrc                    # shamefully-hoist=true
├── biome.json                # Shared Biome config
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # Single service, port 3001
└── packages/
    ├── shared/               # @openmeet/shared - WS message types
    ├── server/               # @openmeet/server - Express + ws + SQLite
    └── client/               # @openmeet/client - Vite + React + shadcn
```

## Package: shared (`packages/shared`)

Single source of truth for WebSocket message types as a discriminated union (`WSMessage`).

**Message types**: `join-room`, `room-joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-state`, `chat-message`, `chat-broadcast`, `error`

**Common interfaces**: `Participant` (id, username, joinedAt), `Room` (id, name, createdAt, participantCount)

## Package: server (`packages/server`)

Express v5 HTTP server + WebSocket signaling + SQLite.

### Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | HTTP server, REST routes, SPA fallback, static files |
| `src/config.ts` | Port (3001), upload dir, max file size (50MB), CORS, max 6 participants |
| `src/db.ts` | `better-sqlite3(':memory:')`, rooms + participants tables |
| `src/room-manager.ts` | CRUD for rooms/participants, cleanup empty rooms |
| `src/signaling.ts` | WebSocket connection management, message routing |
| `src/chat.ts` | Chat message broadcasting |
| `src/file-upload.ts` | Multer disk storage, `POST /api/upload` |

### REST API

- `GET /api/rooms` — list all rooms
- `POST /api/rooms` — create room (body: `{ name }`)
- `GET /api/rooms/:id` — get single room
- `POST /api/upload` — file upload (multer)
- `/uploads/*` — static file serving

### WebSocket signaling flow

1. Client sends `join-room` → server adds to DB + in-memory map, responds with `room-joined` (includes `yourId` + existing participants), broadcasts `participant-joined` to others
2. Signaling messages (`offer`, `answer`, `ice-candidate`) → forwarded directly to target peer by `toId`
3. `mute-state` → broadcast to all other room members
4. `chat-message` → broadcast as `chat-broadcast` to all room members
5. On disconnect → broadcast `participant-left`, remove from DB, clean empty rooms

### Important server details

- **Express v5 path-to-regexp**: Uses `{*path}` for zero-or-more wildcard segments (not `*`)
- **SPA fallback**: Explicit `app.get('/')` + `app.get('{*path}')` for non-API/upload GET requests
- **Periodic cleanup**: `setInterval` every 60s calls `cleanEmptyRooms()`
- **Room limit**: 6 participants max, enforced on `join-room`

## Package: client (`packages/client`)

Vite + React 19 + TanStack Router (file-based) + shadcn/ui (Base UI).

### Key files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Router setup + `RouterProvider` |
| `src/routes/__root.tsx` | Root layout (`Outlet` + `Toaster`) |
| `src/routes/index.tsx` | Home: username input, create/join room |
| `src/routes/room.$roomId.tsx` | Room page: orchestrator wiring all hooks |
| `src/lib/utils.ts` | `cn()`, localStorage username helpers |
| `src/lib/websocket.ts` | `WebSocketClient` class (connect/send/subscribe/reconnect) |
| `src/lib/webrtc.ts` | `PeerConnectionManager` class (RTCPeerConnection lifecycle) |

### Hooks

| Hook | Purpose |
|------|---------|
| `use-websocket.ts` | WS connection + message routing |
| `use-webrtc.ts` | Peer connections + remote streams state |
| `use-media.ts` | getUserMedia/getDisplayMedia + toggle controls |
| `use-audio-level.ts` | Audio level detection via AnalyserNode (speaking indicators) |
| `use-chat.ts` | Chat messages + file upload |
| `use-connection-stats.ts` | WebRTC stats (bitrate, codec, RTT, packet loss) |

### Components

| Component | Purpose |
|-----------|---------|
| `video-tile.tsx` | Single video element with username overlay, speaking glow, fullscreen |
| `video-grid.tsx` | Responsive grid layout (1→2→2x2→3x2) + spotlight mode for screen share |
| `chat-panel.tsx` | Side panel with messages, text input, file attach, image preview |
| `controls-bar.tsx` | Bottom bar: mic/cam/screen/leave/chat/debug toggle buttons |
| `device-selector.tsx` | Audio/video device selection dropdowns |
| `room-code.tsx` | Copy room link to clipboard |
| `top-bar.tsx` | Room name, participant count, room code |
| `ui/*` | shadcn components (Base UI based, not Radix) |

### Vite config

- Plugins: `TanStackRouterVite` (file-based routing), `react()`, `tailwindcss()`
- Path alias: `@` → `./src`
- Dev proxy: `/api` and `/uploads` → `http://localhost:3001`

## WebRTC Implementation Details

### Critical patterns (do NOT change without understanding)

1. **Audio transceiver direction**: Uses `sendrecv` (not `recvonly`) even when no audio track exists. This ensures `ontrack` fires on the remote side, enabling audio level detection and mute state indicators.

2. **Track accumulation**: `ontrack` handler accumulates tracks into a managed `MediaStream` per peer (stored in `this.remoteStreams` Map). Replaces same-kind tracks on renegotiation to avoid duplicates.

3. **Glare handling**: If both peers send offers simultaneously (`signalingState === 'have-local-offer'`), the receiver rolls back its own offer before processing the remote offer.

4. **SDP modification**: `enableStereoOpus()` modifies SDP to add `stereo=1;sprop-stereo=1` for Opus codec lines.

5. **Screen share swap**: Uses `RTCRtpSender.replaceTrack()` to swap between webcam and screen share without renegotiation.

6. **Renegotiation**: `setLocalStream()` tries `replaceTrack()` first, then upgrades existing transceivers, then falls back to `addTrack()`. Only triggers renegotiation when actually needed.

### Remote mute detection

Two complementary strategies:
- **WebSocket `mute-state` messages**: Explicit mute state broadcast on join, toggle, and participant change
- **Stream track check**: Fallback when `isAudioMuted` prop not provided

## UI Component Notes

- **shadcn/ui uses Base UI**, not Radix. Use `render` prop for component composition (not `asChild`).
- **TooltipTrigger**: Renders as `<span className="inline-flex">` to avoid nested `<button>` when wrapping Button components. Do NOT use `display: contents` — it breaks tooltip positioning.
- **Color system**: OKLCH via CSS custom properties in `src/app.css`. Dark mode via `next-themes`.

## Code Style & Conventions

- **Linter/Formatter**: Biome v2.4+ (not ESLint). Config at root `biome.json`.
- **Formatting**: 2-space indent, single quotes, trailing commas, semicolons, 120 char line width
- **Iteration**: Use `for...of` loops, not `.forEach()` (Biome rule)
- **Imports**: Auto-organized by Biome. No `import type` enforcement (`useImportType: off`).
- **noExplicitAny**: Off. `noNonNullAssertion`: Off.
- **File exclusions**: `routeTree.gen.ts` (auto-generated by TanStack Router), `dist/` directories

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start both client (5173) and server (3001) in parallel |
| `pnpm build` | Build shared → client → server (order matters) |
| `pnpm lint` | `biome check .` |
| `pnpm lint:fix` | `biome check --write .` |
| `pnpm format` | `biome format --write .` |

## Docker

- **Multi-stage build**: `node:22-alpine`, builder installs `python3 make g++` for native deps (better-sqlite3)
- **pnpm prune**: Must use `CI=true pnpm prune --prod` (non-TTY environment)
- **Production**: Single container serves both API and client static files on port 3001
- **Uploads volume**: Persisted via Docker volume at `/app/uploads`

## Known Gotchas

1. **Express v5 wildcards**: `path-to-regexp` v8 requires named params. Use `{*path}` not `*`.
2. **pnpm prune in Docker**: Needs `CI=true` prefix for non-interactive environments.
3. **TooltipTrigger positioning**: Must have a real bounding box (`inline-flex`), not `display: contents`.
4. **Audio `ontrack`**: Only fires if transceiver direction is `sendrecv` (not `recvonly`).
5. **TanStack Router gen file**: `routeTree.gen.ts` is auto-generated — exclude from linting.
6. **Build order**: shared must build before client and server (workspace dependency).
7. **STUN servers**: Uses Google public STUN servers. TURN server needed for restrictive NATs.
