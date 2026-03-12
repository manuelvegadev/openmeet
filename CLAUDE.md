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
| Terminal TUI | Ink | v5 |
| Node WebRTC | @roamhq/wrtc | v0.8 |
| Audio I/O | sox (rec/play) | system |
| Terminal Bundler | esbuild | v0.27 |
| CI/CD | GitHub Actions | — |

## Monorepo Structure

```
openmeet/
├── package.json              # Root workspace scripts
├── pnpm-workspace.yaml       # packages/*
├── .npmrc                    # shamefully-hoist=true
├── biome.json                # Shared Biome config
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # Single service, port 3001
├── .github/workflows/        # CI/CD workflows
│   └── publish-terminal.yml  # npm publish on terminal-v* tags
└── packages/
    ├── shared/               # @openmeet/shared - WS message types
    ├── server/               # @openmeet/server - Express + ws + in-memory Maps
    ├── client/               # @openmeet/client - Vite + React + shadcn (PWA)
    └── terminal/             # openmeet-terminal - TUI client (npm package)
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

3. **Track routing by arrival order**: `ontrack` handler routes video tracks by checking if a webcam video already exists in the remote stream — if yes, any new video track is the screen share. This is more robust than transceiver index/reference comparison, which can fail during renegotiation. Backed by `onunmute` fallback on the screen receiver track.

4. **Glare handling**: If both peers send offers simultaneously (`signalingState === 'have-local-offer'`), the receiver rolls back its own offer before processing the remote offer.

5. **SDP modification**: `enableStereoOpus()` modifies SDP to add `stereo=1;sprop-stereo=1` for Opus codec lines.

6. **Screen share via transceiver 2**: `setScreenStream()` targets the 3rd transceiver (index 2), using `replaceTrack()` + direction toggle (`recvonly` ↔ `sendrecv`). Renegotiates only on direction change.

7. **Webcam stream targeting**: `setLocalStream()` explicitly targets transceiver index 0 (audio) and index 1 (webcam video) to avoid accidentally touching the screen transceiver.

8. **Screen share state signaling**: `screen-share-state` WebSocket message broadcasts who is screen sharing. Re-broadcasts on `participants.length` change so newcomers learn current state. When `isScreenSharing: false` is received, the screen stream is immediately set to `null` to prevent showing the last decoded frame.

9. **Screen track `onunmute` fallback**: The screen receiver track's `onunmute` event is used as a fallback for `ontrack` — during renegotiation, `ontrack` may not fire for an existing transceiver whose direction changed from `inactive` to `sendrecv`, but the track's `unmute` event reliably signals the remote started sending.

### Per-peer latency estimation (terminal)

The terminal client estimates one-way audio latency per peer using WebRTC stats already collected in the stats polling loop:

`estimated_latency ≈ RTT/2 + max(jitter × 2, 20ms) + 20ms`

- **RTT/2**: network one-way delay from `candidate-pair.currentRoundTripTime` and `remote-inbound-rtp.roundTripTime`
- **jitter × 2**: jitter buffer estimate (floor 20ms) from `inbound-rtp.jitter`
- **20ms**: fixed processing overhead (capture frame + encode/decode + playback FIFO)

Displayed in participant list as `~Xms` with color coding: dim (≤80ms), yellow (81–150ms), red (>150ms).

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

## Package: terminal (`packages/terminal`)

Terminal UI (TUI) client for OpenMeet — join rooms, audio chat, and text messaging from the terminal. Published to npm as `openmeet-terminal`.

### Key files

| File | Purpose |
|------|---------|
| `src/index.tsx` | CLI entry point: arg parsing, sox/mic checks, alt screen buffer, Ink `render()` |
| `src/app.tsx` | App shell: screen routing (home → device picker → room), room creation |
| `src/version.ts` | App version: build-time `__APP_VERSION__` via esbuild `define`, runtime fallback reads `package.json` |
| `build.mjs` | esbuild bundler: ESM, Node 22, bundles source + shared, externals for deps, injects `__APP_VERSION__` |
| `install.sh` | Curl-pipe installer script (checks Node 22, sox, then `npm install -g`) |

### Components

| Component | Purpose |
|-----------|---------|
| `home-screen.tsx` | Create/join room, server URL display |
| `device-picker.tsx` | Audio input/output device selection (remembers preferences) |
| `room-view.tsx` | Main room: audio, chat, participant list, status bar |
| `chat-input.tsx` | Text input for chat messages |
| `chat-log.tsx` | Scrollable chat message history |
| `participant-list.tsx` | Connected participants with mute/cam/screen indicators |
| `status-bar.tsx` | Connection status, room info |
| `room-log.tsx` | Room event log (joins, leaves, errors) |
| `settings-view.tsx` | Settings screen (audio devices, camera, video overlay) |

### Hooks

| Hook | Purpose |
|------|---------|
| `use-room.ts` | WebSocket + WebRTC orchestration, audio/video pipeline, chat state, per-peer latency estimation (`ConnectionStats.peerLatencyMs`) |

### Lib modules

| Module | Purpose |
|--------|---------|
| `websocket.ts` | WebSocket client for signaling |
| `webrtc.ts` | Peer connection management with `@roamhq/wrtc` |
| `audio.ts` | sox-based audio capture/playback pipelines |
| `audio-test.ts` | Audio device testing utilities |
| `video.ts` | VideoManager: ffmpeg capture (send) + ffplay display (receive), I420 bilinear scaling, overlay |
| `overlay.ts` | 8×8 bitmap font overlay renderer burned into I420 video frames |
| `devices.ts` | Audio/video device enumeration |
| `settings.ts` | Persistent settings (`~/.config/openmeet/settings.json`) |
| `sdp.ts` | SDP manipulation (stereo Opus) |
| `emoji.ts` | Random emoji username generation |

### Tech stack

- **Runtime**: Node.js >= 22
- **TUI framework**: Ink v5 (React for terminal)
- **WebRTC**: `@roamhq/wrtc` (native WebRTC bindings for Node.js)
- **Audio**: sox (`rec` for capture, `play` for playback)
- **Video**: ffmpeg (webcam capture) + ffplay (remote video display)
- **Bundler**: esbuild (single-file ESM bundle with shebang)

### CLI usage

```bash
openmeet [options]
  --server <url>         WebSocket URL (default: wss://openmeet.mvega.pro/ws)
  --room <id>            Room ID to join directly
  --input-device <name>  Input device name (skip device picker)
  --output-device <name> Output device name (skip device picker)
  --no-video             Disable video (audio-only mode)
  --video-device <id>    Video capture device (e.g., "0" for macOS avfoundation)
  --no-overlay           Disable video overlay
  --test-camera          Test camera capture (opens ffplay preview, no room join)
  --debug                Enable debug logging
  -h, --help             Show help
```

### Publishing

Published to npm via GitHub Actions. See [CI/CD](#cicd) section.

## CI/CD

### Workflow: `publish-terminal.yml`

Automates npm publishing of `openmeet-terminal` via GitHub Actions.

- **Trigger**: Push tags matching `terminal-v*` (e.g. `terminal-v0.1.0`)
- **Steps**: checkout → pnpm + Node 22 setup → install → build shared → build terminal → publish to npm → create GitHub Release
- **Secret**: `NPM_TOKEN` (npm automation token, stored in GitHub repo secrets)

### How to publish a new version

```bash
# 1. Bump version in packages/terminal/package.json
# 2. Commit and tag
git add packages/terminal/package.json
git commit -m "Release openmeet-terminal v0.2.0"
git tag terminal-v0.2.0
git push && git push --tags
# GitHub Actions builds, publishes to npm, creates a GitHub Release
```

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
10. **Screen track routing**: Do NOT use transceiver reference equality (`===`) or `.mid` comparison to identify screen tracks in `ontrack` — browsers may return different wrapper objects during renegotiation. Use arrival-order logic instead (first video = webcam, second video = screen).
11. **Screen track renegotiation**: `ontrack` may not fire when the screen transceiver direction changes from `inactive` to `sendrecv`. Always set up an `onunmute` listener on the screen receiver track as a fallback.
10. **Chat panel mobile**: Uses `fixed inset-0` on mobile (fullscreen overlay). Width via CSS variable only applies at `md:` breakpoint.
13. **Terminal npm publish**: Requires `NPM_TOKEN` secret in GitHub repo settings. Tags must match `terminal-v*` pattern to trigger the workflow.
14. **Terminal sox dependency**: `sox` must be installed on the user's system for audio. The CLI checks for `rec` and `play` on startup and exits with instructions if missing.
15. **Terminal esbuild bundle**: `@openmeet/shared` is aliased and inlined; all npm dependencies are kept external (`packages: 'external'`). The output is a single ESM file with a `#!/usr/bin/env node` shebang. `__APP_VERSION__` is injected via esbuild `define`; `src/version.ts` provides a runtime fallback for `tsx` dev mode.
16. **Terminal alt screen + Ink clearTerminal**: Ink writes `\x1b[2J\x1b[3J\x1b[H` when output fills the screen. The `\x1b[3J` (clear scrollback) leaks through the alternate screen buffer on macOS, wiping terminal history. `index.tsx` patches `process.stdout.write` to strip `\x1b[3J`.
17. **Terminal video answerer SDP direction**: In the answerer path, `setRemoteDescription` creates transceivers defaulting to `recvonly`. Must explicitly set `transceivers[1].direction = 'sendrecv'` and munge the SDP before `setLocalDescription` for the webcam video to be sent. Without this, the browser peer never receives video.
18. **Terminal video capture FPS**: macOS avfoundation rejects `-framerate 15` despite listing it as supported. Use 30fps for reliable capture.
19. **Terminal ffmpeg device listing**: `ffmpeg -list_devices` exits non-zero (because `-i ""` is invalid). Must use `spawnSync` (not `execSync`) to capture stderr without throwing.
20. **Terminal video windows manual**: Remote webcam video windows are opened manually by the user (press `w` on selected peer), not automatically. Screen share windows open/close automatically via `screen-share-state` messages. Tracks are stored in refs and attached to VideoManager on demand.
21. **Terminal settings persistence**: Settings stored at `~/.config/openmeet/settings.json`. Includes audio device IDs, video device ID, overlay toggle, and `devicesConfigured` flag. Legacy flat files (`audio-input`/`audio-output`) auto-migrated on first read.
