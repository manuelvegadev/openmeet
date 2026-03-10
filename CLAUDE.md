# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight Google Meet-like video conferencing app. Users create/join rooms to video chat, share screens, send messages, and upload files. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (username stored in localStorage). Installable as a PWA.

## Architecture

```
Client A <──WebRTC P2P──> Client B
   ↑                        ↑
   │   WebSocket (signaling) │
   └──────> Server <─────────┘
              │
        In-memory Maps
```

- **Topology**: P2P mesh — each client connects directly to every other client
- **Signaling**: WebSocket for SDP/ICE exchange, chat messages, mute state, and screen share state
- **Media**: WebRTC with stereo Opus audio (48kHz) and VP8/VP9 video (720p webcam, high-res screen share)
- **Screen sharing**: Simultaneous webcam + screen share via 3 transceivers per connection
- **Files**: HTTP upload to server (tracked per room), URL shared via WebSocket chat. Files deleted when room empties.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=22 |
| Package Manager | pnpm | latest (workspace monorepo) |
| Server Framework | Express | v5 |
| WebSocket | ws | v8 |
| Storage | In-memory Maps | (no database) |
| File Uploads | multer | v1.4 |
| IDs | nanoid | v5 |
| Frontend Framework | React | v19 |
| Routing | TanStack Router | v1 (file-based) |
| Build Tool | Vite | v7 |
| UI Components | shadcn/ui (Base UI) | v4 |
| CSS | Tailwind CSS | v4 (OKLCH color system) |
| Tailwind Plugins | @tailwindcss/typography | latest |
| Icons | lucide-react | latest |
| Markdown | react-markdown | v10 |
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
    ├── server/               # @openmeet/server - Express + ws + in-memory Maps
    └── client/               # @openmeet/client - Vite + React + shadcn (PWA)
```

## Package: shared (`packages/shared`)

Single source of truth for WebSocket message types as a discriminated union (`WSMessage`).

**Message types**: `join-room`, `room-joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-state`, `screen-share-state`, `chat-message`, `chat-broadcast`, `error`

**Common interfaces**: `Participant` (id, username, joinedAt), `Room` (id, name, createdAt, participantCount)

## Package: server (`packages/server`)

Express v5 HTTP server + WebSocket signaling + in-memory Maps.

### Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | HTTP server, REST routes, SPA fallback, static files |
| `src/config.ts` | Port (3001), upload dir, max file size (50MB), CORS, max 6 participants |
| `src/room-manager.ts` | In-memory Maps for rooms/participants, tracks uploaded files per room, cleanup on empty |
| `src/signaling.ts` | WebSocket connection management, message routing |
| `src/chat.ts` | Chat message broadcasting |
| `src/file-upload.ts` | Multer disk storage, `POST /api/upload`, associates uploads with roomId |

### REST API

- `GET /api/rooms` — list all rooms
- `POST /api/rooms` — create room (body: `{ name }`)
- `GET /api/rooms/:id` — get single room
- `POST /api/upload` — file upload (multer, accepts `roomId` in form data)
- `/uploads/*` — static file serving

### WebSocket signaling flow

1. Client sends `join-room` → server adds to in-memory map, responds with `room-joined` (includes `yourId` + existing participants), broadcasts `participant-joined` to others
2. Signaling messages (`offer`, `answer`, `ice-candidate`) → forwarded directly to target peer by `toId`
3. `mute-state` and `screen-share-state` → broadcast to all other room members
4. `chat-message` → broadcast as `chat-broadcast` to all room members
5. On disconnect → broadcast `participant-left`, remove from map. If room is empty, delete all uploaded files from disk and remove room.

### Important server details

- **Express v5 path-to-regexp**: Uses `{*path}` for zero-or-more wildcard segments (not `*`)
- **SPA fallback**: Explicit `app.get('/')` + `app.get('{*path}')` for non-API/upload GET requests
- **Room limit**: 6 participants max, enforced on `join-room`
- **File cleanup**: `RoomState.uploadedFiles` tracks filenames; `removeParticipant()` deletes files from disk when room empties

## Package: client (`packages/client`)

Vite + React 19 + TanStack Router (file-based) + shadcn/ui (Base UI). Installable as a PWA.

### Key files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Router setup + `RouterProvider` |
| `src/routes/__root.tsx` | Root layout (`Outlet` + `Toaster`) |
| `src/routes/index.tsx` | Home: username input, create/join room |
| `src/routes/room.$roomId.tsx` | Room page: orchestrator wiring all hooks |
| `src/lib/utils.ts` | `cn()`, localStorage username helpers |
| `src/lib/websocket.ts` | `WebSocketClient` class (connect/send/subscribe/reconnect) |
| `src/lib/webrtc.ts` | `PeerConnectionManager` class (3 transceivers: audio, webcam, screen) |
| `index.html` | SEO meta tags, OG/Twitter cards, PWA manifest link, service worker registration |
| `public/manifest.webmanifest` | PWA manifest (name, icons, theme color, standalone) |
| `public/sw.js` | Service worker (network-first for static assets, skips API/uploads) |
| `public/favicon.svg` | SVG favicon (indigo gradient + video camera icon) |

### Hooks

| Hook | Purpose |
|------|---------|
| `use-websocket.ts` | WS connection + message routing |
| `use-webrtc.ts` | Peer connections, remote webcam + screen streams, screen share states |
| `use-media.ts` | getUserMedia/getDisplayMedia + toggle controls |
| `use-audio-level.ts` | Audio level detection via AnalyserNode (speaking indicators) |
| `use-connection-stats.ts` | WebRTC stats (bitrate, codec, RTT, packet loss) |

### Components

| Component | Purpose |
|-----------|---------|
| `video-tile.tsx` | Single video element with username overlay, speaking glow, fullscreen, "You are presenting" placeholder |
| `video-grid.tsx` | Responsive grid layout (1→2→2x2→3x2) + spotlight mode, separate webcam + screen share tiles per participant, auto-spotlight on screen share |
| `chat-panel.tsx` | Resizable side panel with markdown messages (react-markdown), auto-growing textarea, file attach, card-style message bubbles, drag-to-resize left border |
| `controls-bar.tsx` | Bottom bar: left (debug), center (mic/cam/device selector/screen/system audio/chat), unread badge on chat button |
| `device-selector.tsx` | Audio/video device selection dropdowns |
| `room-code.tsx` | Copy room link to clipboard |
| `top-bar.tsx` | Room name, participant count, room code |
| `ui/*` | shadcn components (Base UI based, not Radix) |

### Vite config

- Plugins: `TanStackRouterVite` (file-based routing), `react()`, `tailwindcss()`
- Path alias: `@` → `./src`
- Dev proxy: `/api` and `/uploads` → `http://localhost:3001`

### PWA

- `public/manifest.webmanifest` with app name, icons (SVG + PNG 192/512/maskable), theme color `#6366f1`, standalone display
- `public/sw.js` service worker — network-first for static assets, skips API and uploads
- Service worker registered in `index.html` on load
- Apple PWA meta tags for iOS home screen support

### SEO

- Open Graph meta tags (title, description, 1200x630 OG image)
- Twitter Card meta tags (summary_large_image)
- Standard HTML meta description and theme-color
- Branded OG image at `public/og-image.png`

## WebRTC Implementation Details

### Critical patterns (do NOT change without understanding)

1. **3 transceivers per connection**: Created upfront in `createPeerConnection()` — index 0 (audio), index 1 (webcam video), index 2 (screen video). This avoids dynamic m-line additions mid-call and ensures both sides have identical transceiver ordering.

2. **Audio transceiver direction**: Uses `sendrecv` (not `recvonly`) even when no audio track exists. This ensures `ontrack` fires on the remote side, enabling audio level detection and mute state indicators.

3. **Track routing by transceiver index**: `ontrack` handler uses `pc.getTransceivers().indexOf(event.transceiver)` to route tracks. Index 0/1 → `remoteStreams` (webcam+audio). Index 2 → `remoteScreenStreams`.

4. **Glare handling**: If both peers send offers simultaneously (`signalingState === 'have-local-offer'`), the receiver rolls back its own offer before processing the remote offer.

5. **SDP modification**: `enableStereoOpus()` modifies SDP to add `stereo=1;sprop-stereo=1` for Opus codec lines.

6. **Screen share via transceiver 2**: `setScreenStream()` targets the 3rd transceiver (index 2), using `replaceTrack()` + direction toggle (`recvonly` ↔ `sendrecv`). Renegotiates only on direction change.

7. **Webcam stream targeting**: `setLocalStream()` explicitly targets transceiver index 0 (audio) and index 1 (webcam video) to avoid accidentally touching the screen transceiver.

8. **Screen share state signaling**: `screen-share-state` WebSocket message broadcasts who is screen sharing. Re-broadcasts on `participants.length` change so newcomers learn current state.

### Remote mute detection

Two complementary strategies:
- **WebSocket `mute-state` messages**: Explicit mute state broadcast on join, toggle, and participant change
- **Stream track check**: Fallback when `isAudioMuted` prop not provided

### RemoteStream interface

```typescript
interface RemoteStream {
  peerId: string;
  username: string;
  webcamStream: MediaStream;
  screenStream: MediaStream | null;
}
```

## UI Component Notes

- **shadcn/ui uses Base UI**, not Radix. Use `render` prop for component composition (not `asChild`).
- **TooltipTrigger**: Renders as `<span className="inline-flex">` to avoid nested `<button>` when wrapping Button components. Do NOT use `display: contents` — it breaks tooltip positioning.
- **Color system**: OKLCH via CSS custom properties in `src/index.css`. Dark mode via system preference detection.
- **Bar heights**: Top bar and chat header use `h-12`. Controls bar uses `h-14`. Chat input area uses `min-h-14`.
- **Chat panel width**: Resizable on desktop via drag handle on left border. Min 320px, max 60% viewport. Uses CSS variable `--chat-width` applied only at `md:` breakpoint. Mobile is fullscreen overlay.
- **Chat messages**: Rendered as markdown via `react-markdown` with Tailwind Typography `prose` classes. Custom `code` and `pre` components for GitHub-style code blocks. Messages wrapped in card bubbles (`rounded-lg bg-muted/50 border`).
- **Chat input**: Auto-growing `<textarea>` using `field-sizing: content` CSS property. Enter sends, Shift+Enter for new line.
- **Controls bar layout**: Left (debug button), center (main controls), right (spacer). Unread badge on chat button.
- **"You are presenting" placeholder**: Shown on local screen share tile instead of live capture to prevent infinite mirror.

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

- **Multi-stage build**: `node:22-alpine`, builder installs `python3 make g++` for native deps
- **pnpm prune**: Must use `CI=true pnpm prune --prod` (non-TTY environment)
- **Production**: Single container serves both API and client static files on port 3001
- **Uploads volume**: Persisted via Docker volume at `/app/uploads` (files auto-cleaned when rooms empty)

## Known Gotchas

1. **Express v5 wildcards**: `path-to-regexp` v8 requires named params. Use `{*path}` not `*`.
2. **pnpm prune in Docker**: Needs `CI=true` prefix for non-interactive environments.
3. **TooltipTrigger positioning**: Must have a real bounding box (`inline-flex`), not `display: contents`.
4. **Audio `ontrack`**: Only fires if transceiver direction is `sendrecv` (not `recvonly`).
5. **TanStack Router gen file**: `routeTree.gen.ts` is auto-generated — exclude from linting.
6. **Build order**: shared must build before client and server (workspace dependency).
7. **STUN servers**: Uses Google public STUN servers. TURN server needed for restrictive NATs.
8. **Transceiver ordering**: Both sides must create 3 transceivers in identical order (audio, webcam, screen) before SDP exchange. Do not reorder or skip.
9. **Screen share state re-broadcast**: Must re-broadcast on `participants.length` change so newcomers learn the current screen share state.
10. **Chat panel mobile**: Uses `fixed inset-0` on mobile (fullscreen overlay). Width via CSS variable only applies at `md:` breakpoint.
