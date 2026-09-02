# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight, terminal-first audio/video conferencing app. Users create/join rooms from a TUI to talk, share webcam and screen, and send text messages. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (emoji usernames generated locally).

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
- **Media**: WebRTC with stereo Opus audio (48kHz, 256kbps) and VP8/VP9 video (1080p webcam, 1080p screen share)
- **Screen sharing**: Simultaneous webcam + screen share via 3 transceivers per connection

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=22 |
| Package Manager | pnpm | latest (workspace monorepo) |
| Server Framework | Express | v5 |
| WebSocket | ws | v8 |
| Storage | In-memory Maps | (no database) |
| IDs | nanoid | v5 |
| Linting/Formatting | Biome | v2.4+ |
| TypeScript | typescript | v5.7+ |
| Terminal TUI | Ink | v5 |
| Node WebRTC | @roamhq/wrtc | v0.8 |
| Audio I/O | sox (rec/play) | system |
| Video I/O | ffmpeg / ffplay | system |
| Terminal Bundler | esbuild | v0.27 |
| CI/CD | GitHub Actions | — |

## Monorepo Structure

```
openmeet/
├── package.json              # Root workspace scripts
├── pnpm-workspace.yaml       # packages/*
├── .npmrc                    # shamefully-hoist=true
├── biome.json                # Shared Biome config
├── Dockerfile                # Multi-stage build (server only)
├── docker-compose.yml        # Single service, port 3001
├── docs/                     # Architecture docs
├── .github/workflows/        # CI/CD workflows
│   └── publish-terminal.yml  # npm publish on terminal-v* tags
└── packages/
    ├── shared/               # @openmeet/shared - WS message types
    ├── server/               # @openmeet/server - Express + ws + in-memory Maps
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
| `src/index.ts` | HTTP server + REST routes |
| `src/config.ts` | Port (3001), max 6 participants |
| `src/room-manager.ts` | In-memory Maps for rooms/participants, room removed when empty |
| `src/signaling.ts` | WebSocket connection management, message routing |
| `src/chat.ts` | Chat message broadcasting |
| `src/types.ts` | `ConnectedClient` (ws, participantId, roomId, username) |

### REST API

- `GET /api/rooms` — list all rooms
- `POST /api/rooms` — create room (body: `{ name }`)
- `GET /api/rooms/:id` — get single room

### WebSocket signaling flow

1. Client sends `join-room` → server adds to in-memory map, responds with `room-joined` (includes `yourId` + existing participants), broadcasts `participant-joined` to others
2. Signaling messages (`offer`, `answer`, `ice-candidate`) → forwarded directly to target peer by `toId`
3. `mute-state` and `screen-share-state` → broadcast to all other room members
4. `chat-message` → broadcast as `chat-broadcast` to all room members
5. On disconnect → broadcast `participant-left`, remove from map. If room is empty, remove room.

### Important server details

- **Room limit**: 6 participants max, enforced on `join-room`
- **Keepalive**: Server pings all WebSocket clients every 25s to survive reverse proxies
- **No static files**: The server only exposes the REST API and `/ws`. There is no web client.

## WebRTC Implementation Details

### Critical patterns (do NOT change without understanding)

1. **3 transceivers per connection**: Created upfront in the offerer path — index 0 (audio), index 1 (webcam video), index 2 (screen video). This avoids dynamic m-line additions mid-call and ensures both sides have identical transceiver ordering.

2. **Audio transceiver direction**: Uses `sendrecv` (not `recvonly`) even when no audio track exists. This ensures `ontrack` fires on the remote side, enabling audio level detection and mute state indicators.

3. **Answerer path uses `addTrack`**: Only `addTrack`-created transceivers are eligible for m-line matching during `setRemoteDescription`. The answerer pre-attaches audio with `addTrack` and lets `setRemoteDescription` create the two video transceivers, then explicitly sets their directions to `sendrecv` BEFORE `createAnswer()`.

4. **Glare handling (perfect negotiation)**: Lexicographic ID comparison (`myId < peerId` = polite). Polite peer yields on collision by closing and recreating the connection as answerer (@roamhq/wrtc doesn't support rollback). Impolite peer ignores incoming offer.

5. **SDP modification**: `boostOpusQuality()` modifies SDP to add `stereo=1;sprop-stereo=1;maxaveragebitrate=256000` for Opus codec lines.

6. **Connection retry**: Failed connections retry with exponential backoff (1s, 2s, 4s, max 3 attempts). Only the impolite peer (larger ID) retries to avoid simultaneous retry storms.

7. **Screen share via transceiver 2**: `setScreenTrack()` targets the 3rd transceiver (index 2), using `replaceTrack()` + direction toggle (`recvonly` ↔ `sendrecv`) and renegotiates. The renegotiation offer SDP is munged to force `a=sendrecv` on the screen m-line because @roamhq/wrtc may not reflect direction changes.

8. **Webcam via transceiver 1**: `setVideoTrack()` explicitly targets transceiver index 1 to avoid accidentally touching the screen transceiver. Camera mute sends black frames instead of renegotiating.

9. **Screen share state signaling**: `screen-share-state` WebSocket message broadcasts who is screen sharing. Re-broadcasts on `participants.length` change so newcomers learn current state. Remote screen windows close when `isScreenSharing: false` arrives.

### Per-peer latency estimation

The terminal client estimates one-way audio latency per peer using WebRTC stats already collected in the stats polling loop:

`estimated_latency ≈ RTT/2 + max(jitter × 2, 20ms) + 20ms`

- **RTT/2**: network one-way delay from `candidate-pair.currentRoundTripTime` and `remote-inbound-rtp.roundTripTime`
- **jitter × 2**: jitter buffer estimate (floor 20ms) from `inbound-rtp.jitter`
- **20ms**: fixed processing overhead (capture frame + encode/decode + playback FIFO)

Displayed in participant list as `~Xms` with color coding: dim (≤80ms), yellow (81–150ms), red (>150ms).

### Remote mute detection

- **WebSocket `mute-state` messages**: Explicit mute state broadcast on join, toggle, and participant change
- **Stream track check**: Fallback when no mute state has been received yet

## Package: terminal (`packages/terminal`)

Terminal UI (TUI) client for OpenMeet — join rooms, audio chat, video, screen share and text messaging from the terminal. Published to npm as `openmeet-terminal`.

### Key files

| File | Purpose |
|------|---------|
| `src/index.tsx` | CLI entry point: arg parsing, sox/mic checks, alt screen buffer, Ink `render()` |
| `src/app.tsx` | App shell: screen routing (home → device picker → room), room creation via `POST /api/rooms` |
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
| `status-bar.tsx` | Keyboard shortcuts help text, debug mode indicator |
| `room-log.tsx` | Room event log (joins, leaves, errors) |
| `settings-view.tsx` | Settings screen (audio devices, camera, video overlay) |

### Hooks

| Hook | Purpose |
|------|---------|
| `use-room.ts` | WebSocket + WebRTC orchestration, audio/video pipeline, chat state, per-peer latency estimation (`ConnectionStats.peerLatencyMs`) |

### Lib modules

| Module | Purpose |
|--------|---------|
| `websocket.ts` | WebSocket client for signaling (auto-reconnect with backoff, pub/sub) |
| `webrtc.ts` | `PeerConnectionManager` with `@roamhq/wrtc` |
| `audio.ts` | sox-based audio capture/playback pipelines |
| `audio-test.ts` | Audio device testing utilities |
| `video.ts` | VideoManager: ffmpeg webcam + screen capture (send), ffplay display (receive), I420 bilinear scaling with aspect-ratio-preserving letterbox/pillarbox, overlay |
| `overlay.ts` | 8×8 bitmap font overlay renderer burned into I420 video frames |
| `devices.ts` | Audio/video/screen device enumeration (macOS avfoundation, Linux xrandr/pactl) |
| `settings.ts` | Persistent settings (`~/.config/openmeet/settings.json`) |
| `sdp.ts` | SDP manipulation (stereo Opus at 256kbps) |
| `emoji.ts` | Random emoji username generation |

### Tech stack

- **Runtime**: Node.js >= 22
- **TUI framework**: Ink v5 (React for terminal)
- **WebRTC**: `@roamhq/wrtc` (native WebRTC bindings for Node.js)
- **Audio**: sox (`rec` for capture, `play` for playback)
- **Video**: ffmpeg (webcam + screen capture) + ffplay (remote video display)
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
  --test-screen          Test screen capture (lists screens, opens ffplay preview)
  --debug                Enable debug logging (also writes to ~/.config/openmeet/debug.log)
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
- **File exclusions**: `dist/` directories

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start server (3001) + shared in watch mode |
| `pnpm --filter openmeet-terminal dev` | Run the terminal client against `ws://localhost:3001/ws` |
| `pnpm build` | Build shared → server → terminal (order matters) |
| `pnpm lint` | `biome check .` |
| `pnpm lint:fix` | `biome check --write .` |
| `pnpm format` | `biome format --write .` |

## Docker

- **Multi-stage build**: `node:22-alpine`, builds only `shared` + `server` (`pnpm install --filter "@openmeet/server..."` skips the terminal's native `@roamhq/wrtc` build)
- **pnpm prune**: Must use `CI=true pnpm prune --prod` (non-TTY environment)
- **Production**: Single container serves the REST API + WebSocket signaling on port 3001

## Known Gotchas

1. **pnpm prune in Docker**: Needs `CI=true` prefix for non-interactive environments.
2. **Audio `ontrack`**: Only fires if transceiver direction is `sendrecv` (not `recvonly`).
3. **Build order**: shared must build before server and terminal (workspace dependency).
4. **STUN servers**: Uses Google public STUN servers. TURN server needed for restrictive NATs.
5. **Transceiver ordering**: Both sides must end up with 3 transceivers in identical order (audio, webcam, screen) after SDP exchange. Do not reorder or skip.
6. **Screen share state re-broadcast**: Must re-broadcast on `participants.length` change so newcomers learn the current screen share state.
7. **Terminal npm publish**: Requires `NPM_TOKEN` secret in GitHub repo settings. Tags must match `terminal-v*` pattern to trigger the workflow.
8. **Terminal sox dependency**: `sox` must be installed on the user's system for audio. The CLI checks for `rec` and `play` on startup and exits with instructions if missing.
9. **Terminal esbuild bundle**: `@openmeet/shared` is aliased and inlined; all npm dependencies are kept external (`packages: 'external'`). The output is a single ESM file with a `#!/usr/bin/env node` shebang. `__APP_VERSION__` is injected via esbuild `define`; `src/version.ts` provides a runtime fallback for `tsx` dev mode.
10. **Terminal alt screen + Ink clearTerminal**: Ink writes `\x1b[2J\x1b[3J\x1b[H` when output fills the screen. The `\x1b[3J` (clear scrollback) leaks through the alternate screen buffer on macOS, wiping terminal history. `index.tsx` patches `process.stdout.write` to strip `\x1b[3J`.
11. **Terminal video answerer SDP direction**: In the answerer path, `setRemoteDescription` creates transceivers defaulting to `recvonly`. Must explicitly set transceiver directions to `sendrecv` BEFORE `createAnswer()` (not via post-creation SDP munging). This applies to audio (index 0), webcam (index 1), and screen (index 2 when sharing).
12. **Terminal video capture FPS**: macOS avfoundation rejects `-framerate 15` despite listing it as supported. Use 30fps for reliable capture.
13. **Terminal ffmpeg device listing**: `ffmpeg -list_devices` exits non-zero (because `-i ""` is invalid). Must use `spawnSync` (not `execSync`) to capture stderr without throwing.
14. **Terminal video windows manual**: Remote webcam (`w` key) and screen share (`e` key) windows are opened manually by the user on the selected peer. Screen windows auto-close when the peer stops sharing. `w` is gated on the peer having camera on (`remoteVideoMuteStates[peerId] === false`). Tracks are stored in refs and attached to VideoManager on demand.
15. **Terminal settings persistence**: Settings stored at `~/.config/openmeet/settings.json`. Includes audio device IDs, video device ID, overlay toggle, and `devicesConfigured` flag. Legacy flat files (`audio-input`/`audio-output`) auto-migrated on first read.
16. **Terminal screen capture macOS**: Uses ffmpeg avfoundation with `-capture_cursor 1`. Requires Screen Recording permission for the terminal app. On macOS 15 (Sequoia), ffmpeg must be built with ScreenCaptureKit support — older builds hang. The `-r 30` output flag is required because avfoundation ignores `-framerate` for screen capture.
17. **Terminal screen capture resolution**: Captures at 1080p@30fps via ffmpeg scale+pad filter (`scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`). Fixed output ensures predictable I420 frame sizes. Higher resolutions (2K@60fps) overwhelm the Node.js event loop with raw frame data (~330MB/s).
18. **Terminal renegotiation for screen share**: `setScreenTrack()` toggles transceiver 2 direction and triggers renegotiation. The renegotiation offer SDP is munged to force `a=sendrecv` on the screen m-line because @roamhq/wrtc may not reflect direction changes.
19. **Terminal debug log file**: When `--debug` is on, all debug events are written to `~/.config/openmeet/debug.log` via `appendFileSync`. Tail with `tail -f ~/.config/openmeet/debug.log`.
20. **Audio format**: Terminal always captures stereo via sox for @roamhq/wrtc compatibility. Playback always stereo with mono→stereo upmix. `boostOpusQuality()` sets `stereo=1;sprop-stereo=1;maxaveragebitrate=256000` (256kbps).
