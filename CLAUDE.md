# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight, terminal-first audio/video conferencing app. Users create/join rooms from a TUI to talk, share webcam and screen, and send text messages. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (emoji usernames generated locally).

**Platform priorities (decided Sept 2026)**: macOS and Windows first; Linux is paused (keep it compiling, don't invest). **Supported OS releases: Windows 11 and macOS 15 (Sequoia) or later**, on real hardware (`ssh win` for Windows, this Mac for macOS). Older releases run but are labelled untested on the home screen (`lib/platform.ts` `withOsNote` appends it to `features`, from `os.release()`: Darwin ≥ 24, NT 10.0 build ≥ 22000). Windows v1.0 scope is rooms + audio + chat; video stays macOS/Linux only for now. **Versioning**: one version number for the `openmeet-terminal` package on every platform (0.4.0 introduced Windows + the engine process); platform maturity is expressed by the support matrix in the README and the label next to the version in the TUI, not by per-platform versions. 1.0 = macOS/Windows feature parity. The stack stays on Node.js (see `docs/go-migration-analysis.md` for the research behind that decision).

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
| Linting/Formatting | Biome | v2.5+ |
| TypeScript | typescript | v6 |
| Terminal TUI | Ink (React 19) | v7 |
| Node WebRTC | @roamhq/wrtc (libwebrtc M106) | v0.10 |
| Audio I/O | audify (RtAudio: CoreAudio / WASAPI) | v1.10 |
| Audio I/O (legacy) | sox (rec/play) | system, macOS/Linux only |
| Video I/O | ffmpeg / ffplay | system, macOS/Linux only |
| Terminal Bundler | esbuild | v0.28 |
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
│   ├── ci.yml                # lint/build/type-check + native-module smoke on ubuntu/macos/windows
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

### Two processes: TUI and engine

```
openmeet (TUI process)                     openmeet --engine (child process)
  Ink rendering, keyboard, settings          WebSocket signaling
  hooks/use-room.ts (thin IPC client)        PeerConnectionManager (wrtc)
        │ commands (join, mute, chat, …)     AudioManager (audify capture → mix → playback)
        ├──────────────────────────────▶     VideoManager (ffmpeg / ffplay)
        ◀──────────────────────────────┤     stats poll, debug log file
        state snapshots (≤10/s), chat,
        room events, mic-test levels
```

The engine is the same bundle forked with `--engine` (`engine/client.ts`), started at app launch and killed when Ink unmounts. Everything with a 10 ms deadline lives in the engine; the TUI can stall for a full second and audio is unaffected. `hooks/use-room.ts` keeps the exact return shape the components always had, so UI code never touches wrtc, audify or ffmpeg. Device listing and the picker's mic test / test tone also go through the engine, so the native audio module is never loaded in the TUI process.

### Key files

| File | Purpose |
|------|---------|
| `src/index.tsx` | CLI entry point: arg parsing, audio backend selection, sox/mic checks (sox backend only), Ink `render()` with `alternateScreen` |
| `src/app.tsx` | App shell: screen routing (home → device picker → room), room creation via `POST /api/rooms` |
| `src/version.ts` | App version: build-time `__APP_VERSION__` via esbuild `define`, runtime fallback reads `package.json` |
| `build.mjs` | esbuild bundler: ESM, Node 22, bundles source + shared, externals for deps, injects `__APP_VERSION__` |
| `install.sh` | Curl-pipe installer for macOS/Linux (checks Node 22, warns about sox, then `npm install -g`) |
| `install.ps1` | PowerShell installer for Windows (installs Node LTS via winget if missing, `npm install -g`, then registers the Windows Terminal profile and desktop shortcut) |
| `windows/wt-profile.cjs`, `windows/create-shortcut.ps1`, `windows/openmeet.ico`/`.png` | "Own window" on Windows: an OpenMeet profile + theme in Windows Terminal (tab row painted `#282c34` as the title bar, app icon, `closeOnExit: always`) and a desktop `.lnk` running `wt -w new --size 110,34 -p OpenMeet`. Shipped in the npm package (`files`). Limits: WT cannot hide the new-tab/dropdown buttons nor change the taskbar icon; the theme is global to the user's terminal |
| `src/engine/protocol.ts` | IPC contract: `EngineCommand` (TUI → engine), `EngineEvent` (engine → TUI), `RoomState` snapshot, `InputOptions` (channel policy + gain, sent with `join` and `mic-test-start` so the picker's meter shows what a call would send) |
| `src/engine/room-engine.ts` | `RoomEngine`: the room session without React — signaling, WebRTC, audio, video, stats, debug log. Snapshots coalesced to one per 100 ms |
| `src/engine/main.ts` | Engine process entry: IPC dispatch, mic test / test tone, crash → `fatal` event, exits on IPC disconnect |
| `src/engine/client.ts` | TUI-side `EngineClient`: forks the bundle with `--engine`, `send()`, `subscribe()`, `listDevices()`, `dispose()` |
| `src/lib/window-state.ts` | Render-pause policy (`never`/`minimized`/`unfocused`, setting `pauseRendering`, flag `--pause-rendering`). `minimized`: a long-lived helper (PowerShell + Win32 `IsIconic` on the hosting Windows Terminal/console window; `osascript` reading `miniaturized` from Terminal.app/iTerm2) prints state changes. `unfocused`: terminal focus reporting (`ESC[?1004h`), with stdin proxied through a filter because Ink 7 would read `ESC[I`/`ESC[O` as Escape. Emits through the `visibility` emitter; `use-room` holds snapshots/chat/events while hidden and the engine pauses level/stats polling (`set-visible`) |
| `src/lib/platform.ts` | `getPlatformSupport()`: per-OS policy (name, features label, video gate, default audio backend). One package version for all platforms; this is how the UI and the CLI express what that version enables on the current OS |
| `src/lib/diagnostics.ts` | Shared diagnostics: `diagnosticsEnabled()` (`--debug` or `OPENMEET_LOG=1`), `startLoopDelayMonitor()`, Ink render timings from the `onRender` hook |
| `src/lib/audio/tone.ts` | `ToneGenerator`: test tone frames for the device picker and the smoke script |
| `scripts/audio-matrix.ts` | Opens every input and output device the backend sees, reports native rate/channels, frames per second, per-channel RMS and imbalance, and driver errors. Run on any new machine: `pnpm exec tsx scripts/audio-matrix.ts [rtaudio\|sox] [seconds]` |
| `scripts/resampler-test.ts`, `scripts/channels-test.ts` | Pure, device-free checks of the resampler (SNR per ratio) and the channel policy; also run in CI |
| `scripts/audio-smoke.ts` | Audio backend smoke test: lists devices, captures for N seconds, plays a tone. `pnpm exec tsx scripts/audio-smoke.ts [rtaudio\|sox] [seconds] [dump.s16le] [gain]`; `OPENMEET_SMOKE_INPUT/OUTPUT` pick devices by name, `OPENMEET_SMOKE_TIMING=1` prints callback-interval histograms |

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
| `use-room.ts` | Thin binding over the engine process: sends commands, mirrors `RoomState` snapshots, chat and room events into React state. Logic lives in `engine/room-engine.ts` |

### Lib modules

| Module | Purpose |
|--------|---------|
| `websocket.ts` | WebSocket client for signaling (auto-reconnect with backoff, pub/sub) |
| `webrtc.ts` | `PeerConnectionManager` with `@roamhq/wrtc` |
| `audio/backend.ts` | `AudioBackend` interface, `AudioDevice`/`AudioDeviceSelection`, backend selection (platform default from `lib/platform.ts`, `--audio-backend` overrides via `parseBackendFlag`) |
| `audio/rtaudio-backend.ts` | Native backend via audify/RtAudio (default on macOS and Windows): duplex stream when the device runs at 48 kHz, otherwise split streams with capture at the device's native rate (libwebrtc resamples); re-chunks driver periods to 10 ms; playback queue kept at ~20 ms |
| `audio/sox-backend.ts` | Fallback backend (Linux default): `rec` pipe for capture, one `play` process on a FIFO for the mixed output paced by wall-clock; async device listing via `system_profiler`/`pactl` |
| `audio/manager.ts` | `AudioManager`: backend-agnostic pipeline — capture → mute → `CaptureProcessorChain` → `RTCAudioSource`; `RTCAudioSink` per peer → `PeerPlayoutBuffer` → `FrameMixer` → backend. Auto-restarts the backend on device errors (3 attempts, then defaults) |
| `audio/processors.ts` | `CaptureProcessor` interface + chain. **This is the hook for noise suppression** (RNNoise via `@shiguredo/rnnoise-wasm`): a processor gets each 10 ms stereo frame before WebRTC. Add it with `AudioManager.addCaptureProcessor()`; add a settings flag only when the processor lands |
| `audio/mixer.ts` | Per-peer ring buffer (12 frames, 2-frame prefill, drops oldest on overflow) and int32 mixing with per-peer gain |
| `audio/resampler.ts` | Streaming polyphase (Kaiser-windowed sinc) rational resampler, Int16 interleaved, any chunking. ≈90 dB SNR, ~0.5% CPU. Used by the RtAudio backend both ways so streams open at each device's native rate |
| `audio/channels.ts` | `InputConditioner`: channel policy (`auto` detects a mono mic in a stereo pair after 1 s of signal with ≥10 dB imbalance; `stereo`/`mono`/`left`/`right` forced) and input gain in dB with clamping. Also `INPUT_CHANNEL_POLICIES`, `parseChannelsFlag`/`parseGainFlag` (CLI validation) and `imbalanceDb`. Reset on every backend (re)open |
| `audio/pcm-dump.ts` | Diagnostic recorder: `OPENMEET_DUMP_DIR=<dir>` writes raw s16le stereo of the capture (as pushed to WebRTC), each peer's decoded audio (`sink-<id>`) and the mixed output; `OPENMEET_TEST_TONE=1` replaces the mic with a 440 Hz tone |
| `audio-test.ts` | Mic level meter and test tone for the device picker, built on the active backend |
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
  --no-video             Disable video (audio-only mode; always off on Windows)
  --audio-backend <name> rtaudio (native; default on Windows) or sox (default on macOS/Linux)
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

### Workflow: `ci.yml`

On every push to `main` and every PR: `pnpm install`, lint, build, `tsc --noEmit` on the terminal, and a smoke script that loads `@roamhq/wrtc` and `audify` on ubuntu, macOS and Windows runners (runners have no audio devices; enumeration must simply not throw).

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
| `pnpm --filter openmeet-terminal exec tsx scripts/audio-smoke.ts rtaudio 3` | Validate a machine's audio stack without joining a room |
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
8. **Terminal sox dependency**: only for `--audio-backend sox` (default on Linux; macOS and Windows default to RtAudio). The CLI checks for `rec`/`play` on startup only in that case.
9. **Terminal esbuild bundle**: `@openmeet/shared` is aliased and inlined; all npm dependencies are kept external (`packages: 'external'`). The output is a single ESM file with a `#!/usr/bin/env node` shebang. `__APP_VERSION__` is injected via esbuild `define`; `src/version.ts` provides a runtime fallback for `tsx` dev mode.
10. **Terminal alt screen + Ink clearTerminal**: Ink writes `\x1b[2J\x1b[3J\x1b[H` when output fills the screen. The `\x1b[3J` (clear scrollback) leaks through the alternate screen buffer on macOS, wiping terminal history. `index.tsx` patches `process.stdout.write` to strip `\x1b[3J` (Ink now owns the alt screen via `alternateScreen: true`).
11. **Terminal video answerer SDP direction**: In the answerer path, `setRemoteDescription` creates transceivers defaulting to `recvonly`. Must explicitly set transceiver directions to `sendrecv` BEFORE `createAnswer()` (not via post-creation SDP munging). This applies to audio (index 0), webcam (index 1), and screen (index 2 when sharing).
12. **Terminal video capture FPS**: macOS avfoundation rejects `-framerate 15` despite listing it as supported. Use 30fps for reliable capture.
13. **Terminal ffmpeg device listing**: `ffmpeg -list_devices` exits non-zero (because `-i ""` is invalid). Must use `spawnSync` (not `execSync`) to capture stderr without throwing.
14. **Terminal video windows manual**: Remote webcam (`w` key) and screen share (`e` key) windows are opened manually by the user on the selected peer. Screen windows auto-close when the peer stops sharing. `w` is gated on the peer having camera on (`remoteVideoMuteStates[peerId] === false`). Tracks are stored in refs and attached to VideoManager on demand.
15. **Terminal settings persistence**: Settings stored at `~/.config/openmeet/settings.json`. Includes audio device IDs, video device ID, overlay toggle, and `devicesConfigured` flag. Legacy flat files (`audio-input`/`audio-output`) auto-migrated on first read.
16. **Terminal screen capture macOS**: Uses ffmpeg avfoundation with `-capture_cursor 1`. Requires Screen Recording permission for the terminal app. On macOS 15 (Sequoia), ffmpeg must be built with ScreenCaptureKit support — older builds hang. The `-r 30` output flag is required because avfoundation ignores `-framerate` for screen capture.
17. **Terminal screen capture resolution**: Captures at 1080p@30fps via ffmpeg scale+pad filter (`scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`). Fixed output ensures predictable I420 frame sizes. Higher resolutions (2K@60fps) overwhelm the Node.js event loop with raw frame data (~330MB/s).
18. **Terminal renegotiation for screen share**: `setScreenTrack()` toggles transceiver 2 direction and triggers renegotiation. The renegotiation offer SDP is munged to force `a=sendrecv` on the screen m-line because @roamhq/wrtc may not reflect direction changes.
19. **Terminal debug log file**: When `--debug` is on, all debug events are written to `~/.config/openmeet/debug.log` via `appendFileSync`. Tail with `tail -f ~/.config/openmeet/debug.log`.
20. **Audio format**: Every frame crossing the backend boundary is interleaved stereo Int16, 480 frames (10 ms). Backends upmix mono mics and downmix to mono outputs themselves. `boostOpusQuality()` sets `stereo=1;sprop-stereo=1;maxaveragebitrate=256000` (256kbps).
21. **audify (RtAudio) quirks**: (a) its error callback is a *static* shared by every `RtAudio` instance and its destructor calls `closeStream()` unconditionally, so a garbage-collected throwaway instance emits `RtApiCore::closeStream(): no open stream to close!` — keep one long-lived probe instance and treat error types below `UNSPECIFIED` (2) as warnings. (b) `RTAUDIO_MINIMIZE_LATENCY` makes CoreAudio pick the device's *minimum* period (15 frames on common hardware → ~3000 callbacks/s); never pass it. (c) Thread-safe callbacks are only released when a stream is reopened or the object is collected, so a process with an open RtAudio stream will not exit on its own — the CLI already calls `process.exit()` after Ink unmounts; scripts must too. (d) `openStream` returns the driver's actual period; the backend re-chunks both directions to 480 frames. (e) No default-device-change notifications: a device that disappears surfaces as an error and `AudioManager` reopens (falling back to system defaults). (f) Prebuilds exist for darwin arm64/x64, linux x64/arm64, win32 x64/ia32 — no win32-arm64.
21b. **Audio bugs that only ears found (Sept 2026), and how to find the next one**: (1) *Windows → Mac sounded robotic*: the Mac's sox backend wrote a *view* of the reused playback frame to the FIFO stream; Node queues chunks by reference when the pipe write is pending, so later frames overwrote queued ones. Always copy before `stream.write()`; audify's `write()` copies synchronously so the RtAudio path is fine. (2) RtAudio's WASAPI capture resampler is audibly bad, so capture runs at the device's native rate (44.1 kHz on the Roland) and libwebrtc resamples. (3) Do not clock playback from `rec`'s pipe: it is bursty and on another device clock. Method that worked: `OPENMEET_TEST_TONE=1` on the sender, `OPENMEET_DUMP_DIR` on both ends, and on the Mac a BlackHole loopback (`--output-device "BlackHole 2ch"` + `sox -t coreaudio "BlackHole 2ch" … trim 0 15`) analysed for discontinuities; the dump of the *mix* cannot see playback-stage bugs, only the loopback can. A pure tone hides NetEQ time-stretching (WSOLA is seamless on periodic signals), so also read the `NetEQ` debug lines (accel/decel/concealed) when speech is the complaint.
21c. **Device adaptation (Sept 2026)**: `--input-channels` / `--input-gain` are persisted to settings by the TUI and travel to the engine inside `JoinOptions.input` (the engine never reads settings for audio conditioning). The RtAudio backend's `SampleQueue` re-chunks between driver periods and 10 ms frames in both directions. Continued —: the RtAudio backend opens each device at its *native* rate and channel count and converts in-process (`resampler.ts`), never via the driver: WASAPI's capture resampler is audibly bad and CoreAudio would otherwise have its nominal rate changed under the user. Duplex when input and output rates match, split streams otherwise. Mono mics upmix, mono outputs downmix, interfaces with >2 channels are listed per pair (`Name [ch 3-4]`, `AudioDevice.firstChannel`). `channels.ts` handles the "mic on input 1 only" case and gain. Verified with `scripts/audio-matrix.ts` on the Mac (15 in / 15 out incl. 96 kHz and mono devices) and the Windows VM (44.1 kHz), with `resampler-test.ts` (88–98 dB SNR) and a loopback recording of live playback on both ends.
22. **Device ids differ between backends**: sox lists macOS devices by `system_profiler` name (`MIC (BRIDGE CAST X V2-II)`), RtAudio by CoreAudio name (`Roland: MIC (BRIDGE CAST X V2-II)`). Settings persist ids by name, so switching backends shows the device picker once. RtAudio duplicates are disambiguated with ` (2)`, ` (3)`.
23. **Windows**: config/debug log live in `%APPDATA%\openmeet` (`CONFIG_DIR` in settings.ts). Video is force-disabled in `index.tsx`. The sox backend throws on Windows (no mkfifo). The Windows VM (`ssh winvm`) is QEMU without a sound device: WASAPI enumerates zero endpoints over SSH, and only "Remote Audio" endpoints exist inside an RDP session with audio redirection.
24. **Ink 7**: `render(..., { alternateScreen: true, incrementalRendering: true })` replaces the manual `\x1b[?1049h` handling. The `\x1b[3J` strip patch on `process.stdout.write` is still applied. Ink 7 requires React 19.2 and Node 22.
25. **Audio and the TUI are separate processes — keep it that way.** Before the split, a render (10–40 ms on a 2-vCPU Windows VM) on the same loop as the 10 ms audio path caused ~7 capture gaps/s and 10% dropped playout. Now the engine loop only sees audio callbacks, signaling and a stats poll; on the same VM its p99 dropped from ~50 ms to single digits. Diagnostics with `--debug` (or `OPENMEET_LOG=1`, log file without the in-TUI feed), every 10 s in `debug.log`: `Engine loop delay`, `TUI loop delay` (both from `startLoopDelayMonitor` in `lib/diagnostics.ts`), `Ink render` (frames + ms per frame, sent from the TUI through the `log` command), `Audio clock` (input-callback gaps >30 ms). Device enumeration in the engine must stay async (`execFile`, never `execSync`): it runs next to live audio. Snapshots are quantized (VU levels to bar steps) and coalesced (≤10/s) so the TUI renders only when something visible changed. Do not add anything time-sensitive to the TUI process, and do not add heavy work to the engine's loop (RNNoise at <1 ms/frame is fine; anything blocking is not).
26. **Test rig (Sept 2026)**: a real Windows 11 machine (`ssh win`, 192.168.68.61, i7-9700K, Windows Terminal, Node 24 LTS + pnpm via winget/npm, repo copy at `C:\Users\mvega\openmeet` synced with tar over scp) with a Roland BRIDGE CAST X V2-II (WASAPI `MIC (BRIDGE CAST X V2-II)` / `Speakers (BRIDGE CAST X V2-II)`, 44.1 kHz); the Mac has the V2-I (`Roland: MIC (BRIDGE CAST X V2-I)` for RtAudio). The QEMU VM (`ssh winvm`) is the older rig. The default shell over SSH to Windows is cmd, which mangles double quotes inside the command: put anything with quotes in a `.cmd`/`.ps1` file and run that (`C:\Users\mvega\openmeet.cmd`, `openmeet-test.cmd` with the Roland devices, `matrix.cmd`, `smoke.cmd`, `win-setup.ps1`). Run the TUI over `ssh -tt win …` so Ink gets a ConPTY (pipe `sleep N |` into ssh to keep stdin open; on hang-up the engine reports exit code 3221225786 = STATUS_CONTROL_C_EXIT, that is the session closing, not a crash). `wss://openmeet.mvega.pro/ws` is not deployed and the Ubuntu host may be off: run the server on the Mac (`node packages/server/dist/index.js`) and point both clients at `ws://<mac-ip>:3001/ws`. Minimized detection needs a real window, so over SSH the watcher logs "host window not found".
27. **Noise suppression (future)**: implement as a `CaptureProcessor` (RNNoise expects 480-sample mono float frames at 48 kHz: downmix → process → upmix), add it via `AudioManager.addCaptureProcessor()` and introduce a settings flag with it. Keep per-frame cost well under 1 ms — it runs on the main thread, on the 10 ms audio cadence. Echo cancellation is deferred (headphones-first); Windows' driver AEC/Voice Clarity would need `AudioCategory_Communications`, which RtAudio doesn't set.
