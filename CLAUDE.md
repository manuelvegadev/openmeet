# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight, terminal-first audio/video conferencing app. Users create/join rooms from a TUI to talk, share webcam and screen, and send text messages. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (emoji usernames generated locally).

**Platform priorities (decided Sept 2026)**: macOS and Windows first; Linux is paused (keep it compiling, don't invest). **Supported OS releases: Windows 11 and macOS 15 (Sequoia) or later**, on real hardware (`ssh win` for Windows, this Mac for macOS). Older releases run but are labelled untested on the home screen (`lib/platform.ts` `withOsNote` appends it to `features`, from `os.release()`: Darwin ≥ 24, NT 10.0 build ≥ 22000). Windows v1.0 scope is rooms + audio + chat; screen sharing works on Windows too (gdigrab), webcam stays macOS/Linux only for now. **Versioning**: one version number for the `openmeet-terminal` package on every platform (0.4.0 introduced Windows + the engine process); platform maturity is expressed by the support matrix in the README and the label next to the version in the TUI, not by per-platform versions. 1.0 = macOS/Windows feature parity. The stack stays on Node.js (see `docs/go-migration-analysis.md` for the research behind that decision).

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
- **Media**: WebRTC with stereo Opus audio (48 kHz, 128 kbps per direction by default, RED-protected) and VP8/VP9 video (1080p webcam, 1080p screen share capped at 2.5 Mbps and scaled down as the mesh grows)
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
- `POST /api/rooms` — create room (body: `{ name }`). Unused by the TUI, which lets `join-room` create the room; a room created here and never joined is never collected, because `removeParticipant` only sweeps on disconnect
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

5. **SDP modification**: our own description gets `stereo=1;sprop-stereo=1` and `maxaveragebitrate` from `audioReceiveKbps` (default 128 kbps — per RFC 7587 that field constrains the *remote* encoder), plus RED promoted ahead of bare Opus. The peer's description is rewritten with `audioSendKbps` before `setRemoteDescription`, which is the only lever on our own encoder.

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
| `src/app.tsx` | App shell: screen routing (home → device picker → room). Joining is the only way in — the server's `join-room` calls `ensureRoom`, so typing a room nobody is in creates it. There is no separate create step |
| `src/version.ts` | App version: build-time `__APP_VERSION__` via esbuild `define`, runtime fallback reads `package.json` |
| `build.mjs` | esbuild bundler: ESM, Node 22, bundles source + shared, externals for deps, injects `__APP_VERSION__` |
| `install.sh` | Curl-pipe installer for macOS/Linux (checks Node 22, warns about sox, then `npm install -g`) |
| `install.ps1` | PowerShell installer for Windows (installs Node LTS via winget if missing, `npm install -g`, ffmpeg via winget `Gyan.FFmpeg` if missing (screen sharing), then registers the Windows Terminal profile and desktop shortcut) |
| `windows/wt-profile.cjs`, `windows/create-shortcut.ps1`, `windows/openmeet.ico`/`.png` | "Own window" on Windows: an OpenMeet profile + theme in Windows Terminal (tab row painted `#282c34` as the title bar, app icon, `closeOnExit: always`) and a desktop `.lnk` running `wt -w new --size 110,34 -p OpenMeet`. Shipped in the npm package (`files`). Limits: WT cannot hide the new-tab/dropdown buttons nor change the taskbar icon; the theme is global to the user's terminal |
| `src/engine/protocol.ts` | IPC contract: `EngineCommand` (TUI → engine), `EngineEvent` (engine → TUI), `RoomState` snapshot, `InputOptions` (channel policy + gain, sent with `join` and `mic-test-start` so the picker's meter shows what a call would send) |
| `src/engine/room-engine.ts` | `RoomEngine`: the room session without React — signaling, WebRTC, audio, video, stats, debug log. Snapshots coalesced to one per 100 ms |
| `src/engine/main.ts` | Engine process entry: IPC dispatch, mic test / test tone, crash → `fatal` event, exits on IPC disconnect |
| `src/engine/client.ts` | TUI-side `EngineClient`: forks the bundle with `--engine`, `send()`, `subscribe()`, `listDevices()`, `dispose()` |
| `src/lib/window-state.ts` | Render-pause policy (`never`/`minimized`/`unfocused`, setting `pauseRendering`, flag `--pause-rendering`). `minimized`: a long-lived helper (PowerShell + Win32 `IsIconic` on the hosting Windows Terminal/console window; `osascript` reading `miniaturized` from Terminal.app/iTerm2) prints state changes. `unfocused`: terminal focus reporting (`ESC[?1004h`), with stdin proxied through a filter because Ink 7 would read `ESC[I`/`ESC[O` as Escape. Emits through the `visibility` emitter; `use-room` holds snapshots/chat/events while hidden and the engine pauses level/stats polling (`set-visible`) |
| `src/lib/platform.ts` | `getPlatformSupport()`: per-OS policy (name, features label, `video` = ffmpeg pipeline available, `webcam` = camera capture implemented, default audio backend). One package version for all platforms; this is how the UI and the CLI express what that version enables on the current OS |
| `src/lib/diagnostics.ts` | Shared diagnostics: `diagnosticsEnabled()` (`--debug` or `OPENMEET_LOG=1`), `startLoopDelayMonitor()`, Ink render timings from the `onRender` hook |
| `src/lib/audio/tone.ts` | `ToneGenerator`: test tone frames for the device picker and the smoke script |
| `scripts/audio-matrix.ts` | Opens every input and output device the backend sees, reports native rate/channels, frames per second, per-channel RMS and imbalance, and driver errors. Run on any new machine: `pnpm exec tsx scripts/audio-matrix.ts [rtaudio\|sox] [seconds]` |
| `scripts/resampler-test.ts`, `scripts/channels-test.ts`, `scripts/sdp-test.ts` | Pure, device-free checks of the resampler (SNR per ratio), the channel policy, and the Opus negotiation helpers against real wrtc SDP; all three run in CI |
| `scripts/av-bench.ts` | A/V pipeline benchmark: drives the real `VideoManager` on both sides of a loopback PeerConnection while the real audio frame pipeline runs at 10 ms, and reports how often the audio gap exceeds 30 ms. `pnpm exec tsx scripts/av-bench.ts [seconds] [screen]`, `OPENMEET_BENCH_NOISE=1` to include RNNoise. Baselines and results in `docs/performance.md` |
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
| `status-bar.tsx` | The room's button bar, built from `key-hints.tsx`. Always-available actions first so the left half never moves, then the ones that depend on the selected peer (`w`/`e`), then the debug toggle |
| `level-bar.tsx` | `levelColor` (the meter's one threshold ladder), `MicBar` (the mic-test meter) and `VuMeter` (the per-participant, volume-scaled one). Was three copies in three components, one of which still used named ANSI colours |
| `text.tsx` | `Rule`: a horizontal rule that spans its container, built from a Box's top border rather than a `repeat`-ed string (see gotcha 30d) |
| `text.tsx` | `Text` with the theme applied. Ink inherits a background down the tree but not a foreground, so a bare `<Text>` would render in the terminal's default colour — black, on a light theme, over our dark background. Defaulting it here is what keeps that from being a bug in every new line of UI. `dimColor` is accepted but remapped to an explicit grey |
| `key-hints.tsx` | `KeyHints` (a row of footer buttons) and `KeyChip` (one key inline in a sentence). One background per button covering the key and what it does, key in bold, one space between buttons: `m mute`, `s share screen`. The chip sets its own foreground and background so it reads on any terminal theme; the palette is fixed because Ink cannot detect the terminal background. Every bottom-bar hint row uses it, so they stay identical |
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
| `audio/noise-suppression.ts` | RNNoise as a `CaptureProcessor`, opt-in via `noiseSuppression`. 0.22 ms/frame when both channels match (any mono mic), 0.45 ms when genuinely stereo — each channel gets its own denoiser so a stereo source keeps its image |
| `audio/processors.ts` | `CaptureProcessor` interface + chain. **This is the hook for noise suppression** (RNNoise via `@shiguredo/rnnoise-wasm`): a processor gets each 10 ms stereo frame before WebRTC. Add it with `AudioManager.addCaptureProcessor()`; add a settings flag only when the processor lands |
| `audio/mixer.ts` | Per-peer ring buffer (12 frames, 2-frame prefill, drops oldest on overflow) and int32 mixing with per-peer gain |
| `audio/resampler.ts` | Streaming polyphase (Kaiser-windowed sinc) rational resampler, Int16 interleaved, any chunking. ≈90 dB SNR, ~0.5% CPU. Used by the RtAudio backend both ways so streams open at each device's native rate |
| `audio/channels.ts` | `InputConditioner`: channel policy (`auto` detects a mono mic in a stereo pair after 1 s of signal with ≥10 dB imbalance; `stereo`/`mono`/`left`/`right` forced) and input gain in dB with clamping. Also `INPUT_CHANNEL_POLICIES`, `parseChannelsFlag`/`parseGainFlag` (CLI validation) and `imbalanceDb`. Reset on every backend (re)open |
| `audio/pcm-dump.ts` | Diagnostic recorder: `OPENMEET_DUMP_DIR=<dir>` writes raw s16le stereo of the capture (as pushed to WebRTC), each peer's decoded audio (`sink-<id>`) and the mixed output; `OPENMEET_TEST_TONE=1` replaces the mic with a 440 Hz tone |
| `audio-test.ts` | Mic level meter and test tone for the device picker, built on the active backend |
| `video.ts` | VideoManager: ffmpeg webcam + screen capture (send), ffplay display (receive), overlay. `FrameAssembler` fills one preallocated frame from the pipe instead of growing a Buffer (5.22 → 0.03 ms/frame). Receive is 1:1: ffplay is spawned at the source resolution and respawned if it changes, so nothing is rescaled in JS |
| `capture-args.ts` | `webcamCaptureArgs(device)` (avfoundation / v4l2, `null` where webcam is unsupported), `screenCaptureCandidates(device)` — ffmpeg argument sets best first (avfoundation / **ddagrab** then gdigrab / x11grab, fixed 1080p30 I420 output); the caller walks the list when one yields no frames, which is how an RDP session falls back off DDA and `rawVideoPlayerArgs()` for ffplay — which caps the *window* at 1280x720 with `-x`/`-y` (`playerWindowSize`, downscale only) so a 1080p share does not open edge to edge on a 1080p monitor, while the stream keeps its own resolution. Plus the size constants. wrtc-free so the CLI's `--test-camera` / `--test-screen` run exactly what a call runs |
| `overlay.ts` | 8×8 bitmap font overlay renderer burned into I420 video frames |
| `devices.ts` | Video/screen device enumeration (macOS avfoundation, Linux xrandr, Windows PowerShell `Screen.AllScreens` with DPI awareness). Screens are cached 60 s and `prefetchScreenDevices()` warms the cache when a room opens, because the PowerShell call costs ~1 s and runs synchronously in the TUI on the `s` key |
| `theme.ts` | The palette, in 24-bit hex. Named ANSI colours are palette *indices*, so `color="yellow"` is a different hue in every terminal theme; `dimColor` (SGR 2) is reduced opacity, a substituted palette entry, or nothing, depending on the emulator. Hex renders as `38;2;R;G;B` on truecolor and quantises to indices ≥ 16 on 256-colour terminals, and those are fixed by the xterm spec rather than the theme — so Ghostty, iTerm2, Windows Terminal and macOS Terminal (256-colour only) all agree. Only a 16-colour terminal falls back to the theme |
| `settings.ts` | Persistent settings (`~/.config/openmeet/settings.json`) |
| `sdp.ts` | Opus negotiation: `boostOpusQuality` (our description — stereo, and the ceiling peers may spend sending to us), `capOutgoingAudioBitrate` (the peer's description — our own send ceiling), `preferAudioRed` (RED ahead of bare Opus). Default 128 kbps each way; `AUDIO_KBPS_STEPS` is what the settings screen cycles |
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
  --no-video             Disable video (audio-only mode; webcam is macOS/Linux only)
  --audio-backend <name> rtaudio (native; default on Windows) or sox (default on macOS/Linux)
  --audio-send-kbps <n>  Opus ceiling for what we send (default 128, saved)
  --audio-receive-kbps <n>  Opus ceiling for what peers send us (default 128, saved)
  --noise-suppression    RNNoise on the mic (--no-noise-suppression to turn off, saved)
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
14. **Terminal video windows manual**: Remote webcam (`w` key) and screen share (`e` key) windows are opened manually by the user on the selected peer. Screen windows auto-close when the peer stops sharing. `w` is gated on the peer having camera on (`remoteVideoMuteStates[peerId] === false`) or a window already being open; `e` on `remoteScreenShareStates[peerId]`. The status bar derives `peerCam`/`peerScreen` from exactly those conditions, so the `w` and `e` buttons appear only when they would do something and read `watch`/`close` for what the key would actually do — keep the two in step, a drawn button that does nothing is worse than no button. Tracks are stored in refs and attached to VideoManager on demand.
15. **Terminal settings persistence**: Settings stored at `~/.config/openmeet/settings.json`. Includes audio device IDs, video device ID, overlay toggle, and `devicesConfigured` flag. Legacy flat files (`audio-input`/`audio-output`) auto-migrated on first read.
16. **Terminal screen capture macOS**: Uses ffmpeg avfoundation with `-capture_cursor 1`. Requires Screen Recording permission for the terminal app. On macOS 15 (Sequoia), ffmpeg must be built with ScreenCaptureKit support — older builds hang. The `-r 30` output flag is required because avfoundation ignores `-framerate` for screen capture.
17. **Terminal screen capture resolution**: Captures at 1080p@30fps via ffmpeg scale+pad filter (`scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`). Fixed output ensures predictable I420 frame sizes. Higher resolutions (2K@60fps) overwhelm the Node.js event loop with raw frame data (~330MB/s).
18. **Terminal renegotiation for screen share**: `setScreenTrack()` toggles transceiver 2 direction and triggers renegotiation. The renegotiation offer SDP is munged to force `a=sendrecv` on the screen m-line because @roamhq/wrtc may not reflect direction changes. If the ffmpeg capture process dies while sharing (permission denied, no desktop, crash) `VideoManager.onScreenCaptureEnded` fires and the engine, if it still thinks it is sharing, calls `stopScreenShare()`, so the transceiver goes back to `recvonly`, peers get `isScreenSharing: false` and the room log shows why; without it the peer would keep a dead screen track.
19. **Terminal debug log file**: When `--debug` is on, all debug events are written to `~/.config/openmeet/debug.log` via `appendFileSync`. Tail with `tail -f ~/.config/openmeet/debug.log`.
20. **Audio format**: Every frame crossing the backend boundary is interleaved stereo Int16, 480 frames (10 ms). Backends upmix mono mics and downmix to mono outputs themselves. `boostOpusQuality()` sets `stereo=1;sprop-stereo=1` plus `maxaveragebitrate` from the receive setting (128 kbps by default).
21. **audify (RtAudio) quirks**: (a) its error callback is a *static* shared by every `RtAudio` instance and its destructor calls `closeStream()` unconditionally, so a garbage-collected throwaway instance emits `RtApiCore::closeStream(): no open stream to close!` — keep one long-lived probe instance and treat error types below `UNSPECIFIED` (2) as warnings. (b) `RTAUDIO_MINIMIZE_LATENCY` makes CoreAudio pick the device's *minimum* period (15 frames on common hardware → ~3000 callbacks/s); never pass it. (c) Thread-safe callbacks are only released when a stream is reopened or the object is collected, so a process with an open RtAudio stream will not exit on its own — the CLI already calls `process.exit()` after Ink unmounts; scripts must too. (d) `openStream` returns the driver's actual period; the backend re-chunks both directions to 480 frames. (e) No default-device-change notifications: a device that disappears surfaces as an error and `AudioManager` reopens (falling back to system defaults). (f) Prebuilds exist for darwin arm64/x64, linux x64/arm64, win32 x64/ia32 — no win32-arm64. (g) On Windows with *zero* audio endpoints (a CI runner, a machine with every device disabled) opening RtAudio crashes the process: `RtApiWasapi::probeDevices: No devices found.` then SIGSEGV. CI therefore only loads the module on Windows runners and enumerates on the other two; the engine process contains the crash if a user ever hits it. (h) audify ships no prebuilt binary in its npm tarball: an install script downloads it, so any environment that blocks package install scripts leaves the app without audio (`install.ps1` verifies and repairs this).
21b. **Audio bugs that only ears found (Sept 2026), and how to find the next one**: (1) *Windows → Mac sounded robotic*: the Mac's sox backend wrote a *view* of the reused playback frame to the FIFO stream; Node queues chunks by reference when the pipe write is pending, so later frames overwrote queued ones. Always copy before `stream.write()`; audify's `write()` copies synchronously so the RtAudio path is fine. (2) RtAudio's WASAPI capture resampler is audibly bad, so capture runs at the device's native rate (44.1 kHz on the Roland) and libwebrtc resamples. (3) Do not clock playback from `rec`'s pipe: it is bursty and on another device clock. Method that worked: `OPENMEET_TEST_TONE=1` on the sender, `OPENMEET_DUMP_DIR` on both ends, and on the Mac a BlackHole loopback (`--output-device "BlackHole 2ch"` + `sox -t coreaudio "BlackHole 2ch" … trim 0 15`) analysed for discontinuities; the dump of the *mix* cannot see playback-stage bugs, only the loopback can. A pure tone hides NetEQ time-stretching (WSOLA is seamless on periodic signals), so also read the `NetEQ` debug lines (accel/decel/concealed) when speech is the complaint.
21c. **Device adaptation (Sept 2026)**: `--input-channels` / `--input-gain` are persisted to settings by the TUI and travel to the engine inside `JoinOptions.input` (the engine never reads settings for audio conditioning). The RtAudio backend's `SampleQueue` re-chunks between driver periods and 10 ms frames in both directions. Continued —: the RtAudio backend opens each device at its *native* rate and channel count and converts in-process (`resampler.ts`), never via the driver: WASAPI's capture resampler is audibly bad and CoreAudio would otherwise have its nominal rate changed under the user. Duplex when input and output rates match, split streams otherwise. Mono mics upmix, mono outputs downmix, interfaces with >2 channels are listed per pair (`Name [ch 3-4]`, `AudioDevice.firstChannel`). `channels.ts` handles the "mic on input 1 only" case and gain. Verified with `scripts/audio-matrix.ts` on the Mac (15 in / 15 out incl. 96 kHz and mono devices) and the Windows VM (44.1 kHz), with `resampler-test.ts` (88–98 dB SNR) and a loopback recording of live playback on both ends.
22. **Device ids differ between backends**: sox lists macOS devices by `system_profiler` name (`MIC (BRIDGE CAST X V2-II)`), RtAudio by CoreAudio name (`Roland: MIC (BRIDGE CAST X V2-II)`). Settings persist ids by name, so switching backends shows the device picker once. RtAudio duplicates are disambiguated with ` (2)`, ` (3)`.
23. **Windows**: config/debug log live in `%APPDATA%\openmeet` (`CONFIG_DIR` in settings.ts). Screen sharing uses ffmpeg **`ddagrab`** (Desktop Duplication, `output_idx` per monitor, `dup_frames=false` so a still desktop costs nothing — 41% of a core down to 3%) with an automatic fallback to `gdigrab` (`-i desktop` with `-offset_x/-offset_y/-video_size`, offsets relative to the primary monitor's origin in physical pixels) when DDA has no output, and ffplay for display; webcam is gated off by `platform.ts` `webcam: false`, which `index.tsx` turns into `webcamEnabled` on `RoomState` (the `v` key, the status bar, the engine's join-time capture) while `webcamCaptureArgs()` returns `null` so `VideoManager.startCapture` refuses regardless of caller. **Screen capture needs the interactive desktop**: a process started over SSH lives in session 0 and sees a fake 1024x768 "WinDisc" display, gdigrab fails with error 5; `schtasks /create … /it` + `/run` puts a process in the user's session, which only has a display while that session is connected (console, RDP or Parsec; a disconnected session fails the same way). In an RDP session gdigrab captures the RDP client's resolution, not the physical monitor's. Test capture from the desktop shortcut, or drive the TUI from a scheduled task with `SendKeys` (see the test-rig memory). The sox backend throws on Windows (no mkfifo). The Windows VM (`ssh winvm`) is QEMU without a sound device: WASAPI enumerates zero endpoints over SSH, and only "Remote Audio" endpoints exist inside an RDP session with audio redirection.
24. **Ink 7**: `render(..., { alternateScreen: true, incrementalRendering: true })` replaces the manual `\x1b[?1049h` handling. The `\x1b[3J` strip patch on `process.stdout.write` is still applied. Ink 7 requires React 19.2 and Node 22.
24b. **The video paths are audio work.** Everything that runs on the engine's loop delays the 10 ms audio cadence, and audify silently drops a capture frame it cannot deliver (`NonBlockingCall`), so a video cost of a few ms is an audible dropout. Sharing a screen used to produce 7 to 11 dropouts every 10 s on the Windows box; the frame assembler, the 1:1 receive path and `dup_frames=false` took that to zero. Before changing anything on these paths, run `scripts/av-bench.ts` and compare against `docs/performance.md`. On Windows the engine also raises itself to `HIGH_PRIORITY_CLASS` at join (`os.setPriority`, no elevation needed): RtAudio's WASAPI thread already has MMCSS "Pro Audio", but the mixing happens on an ordinary event loop that a fullscreen game — with Game Mode deprioritizing background apps — would otherwise outrank.
25. **Audio and the TUI are separate processes — keep it that way.** Before the split, a render (10–40 ms on a 2-vCPU Windows VM) on the same loop as the 10 ms audio path caused ~7 capture gaps/s and 10% dropped playout. Now the engine loop only sees audio callbacks, signaling and a stats poll; on the same VM its p99 dropped from ~50 ms to single digits. Diagnostics with `--debug` (or `OPENMEET_LOG=1`, log file without the in-TUI feed), every 10 s in `debug.log`: `Engine loop delay`, `TUI loop delay` (both from `startLoopDelayMonitor` in `lib/diagnostics.ts`), `Ink render` (frames + ms per frame, sent from the TUI through the `log` command), `Audio clock` (input-callback gaps >30 ms). Device enumeration in the engine must stay async (`execFile`, never `execSync`): it runs next to live audio. Snapshots are quantized (VU levels to bar steps) and coalesced (≤10/s) so the TUI renders only when something visible changed. Do not add anything time-sensitive to the TUI process, and do not add heavy work to the engine's loop (RNNoise at <1 ms/frame is fine; anything blocking is not).
26. **Test rig (Sept 2026)**: a real Windows 11 machine (`ssh win`, 192.168.68.61, i7-9700K, Windows Terminal, Node 24 LTS + pnpm via winget/npm, repo copy at `C:\Users\mvega\openmeet` synced with tar over scp) with a Roland BRIDGE CAST X V2-II (WASAPI `MIC (BRIDGE CAST X V2-II)` / `Speakers (BRIDGE CAST X V2-II)`, 44.1 kHz); the Mac has the V2-I (`Roland: MIC (BRIDGE CAST X V2-I)` for RtAudio). The QEMU VM (`ssh winvm`) is the older rig. The default shell over SSH to Windows is cmd, which mangles double quotes inside the command: put anything with quotes in a `.cmd`/`.ps1` file and run that (`C:\Users\mvega\openmeet.cmd`, `openmeet-test.cmd` with the Roland devices, `matrix.cmd`, `smoke.cmd`, `win-setup.ps1`). Run the TUI over `ssh -tt win …` so Ink gets a ConPTY (pipe `sleep N |` into ssh to keep stdin open; on hang-up the engine reports exit code 3221225786 = STATUS_CONTROL_C_EXIT, that is the session closing, not a crash). `wss://openmeet.mvega.pro/ws` is not deployed and the Ubuntu host may be off: run the server on the Mac (`node packages/server/dist/index.js`) and point both clients at `ws://<mac-ip>:3001/ws`. Minimized detection needs a real window, so over SSH the watcher logs "host window not found".
27. **`setParameters` is unusable after negotiation in @roamhq/wrtc**: `getParameters()` does not expose the per-encoding `ssrc`, so the round-trip fails with `Attempted to set RtpParameters with modified SSRC` once a sender has one. Everything must be set *before* `setLocalDescription` — `sendEncodings` on `addTransceiver` (offerer) or `setParameters` right after `setRemoteDescription` (answerer, which builds senders with `addTrack` and would otherwise carry no parameters at all). Of the encoding fields only `priority`, `maxBitrate` and `degradationPreference` survive; `networkPriority` and `maxFramerate` are dropped silently and never come back from `getParameters()`. `networkPriority` would be a no-op regardless: libwebrtc leaves `enableDscp` false by default, and Windows ignores `setsockopt(IP_TOS)` without a machine-wide QoS policy. Consequence: a live connection keeps the ceiling it was created with until it renegotiates.
28. **ddagrab needs a real GPU output, and no GPU scaler works**: inside an RDP session DDA fails with `Failed to enumerate DXGI output 0` while gdigrab captures that session fine, hence the fallback in `capture-args.ts`. Keeping the frame on the GPU is not an option either — measured on ffmpeg 9.0.1 (Gyan full build, RTX 2080 SUPER): `scale_d3d11` fails with `Could not create the texture (80070057)`, and `hwmap=derive_device` to both CUDA and Vulkan returns `-40` (ENOSYS). So the colour conversion is downloaded and done on the CPU. `h264_nvenc` *does* accept ddagrab's D3D11 frames directly at 1% of a core, but wrtc offers no H.264 and has no hardware encoder factory, so that only pays off if video ever leaves WebRTC. `output_idx` is taken from the `Screen.AllScreens` enumeration order, which matches DXGI on a single-adapter machine but is unverified with several monitors or GPUs. Never put `-r` on the output: it restores the frame duplication `dup_frames=false` just avoided.
29. **`@jitsi/rnnoise-wasm` must be imported by full path**: its package entry re-exports with extensionless specifiers that Node's ESM resolver rejects (`ERR_MODULE_NOT_FOUND` at runtime, though bundlers and tsx resolve it), so `noise-suppression.ts` imports `@jitsi/rnnoise-wasm/dist/rnnoise-sync.js` directly. The `@shiguredo` build is browser-only and throws "not compiled for this environment" under Node.
30g. **Only the offerer can set send parameters in @roamhq/wrtc.** The answerer's senders come from `addTrack` and `setRemoteDescription`; before negotiation `getParameters()` reports `encodings: []` and adding one is refused with "Attempted to set RtpParameters with different encoding count", and after negotiation the ssrc check refuses everything (gotcha 27). So an answerer's audio keeps the allocator's default share and its screen share is uncapped until it becomes the offerer of a renegotiation. `applySendParameters` therefore never changes the encoding count, and it logs refusals instead of swallowing them — a silent catch there hid this for a while.
30f. **`incrementalRendering` is off, and a resize is why.** Ink's incremental writer positions the cursor from the previous frame's geometry; a resize invalidates that, because the terminal reflows the rows already on screen, so the walk lands in the wrong place and rows keep their old right edge — the frame's right border vanished on some rows and not others. Dragging a window edge corrupted it 3 times out of 4; with full frames it survived every resize tried (width-only, height-only, one-column steps, large jumps), verified by reading Ghostty's own text buffer through the accessibility API after each one. The old note claiming a full-frame ConPTY write blocks 50-70 ms does not reproduce: measured on the real Windows box it is p50 0.19 ms, and a full repaint costs 117 KB/s against 12 KB/s. Also: verify a render fix after **every** step, not once at the end — sampling only the final state is how the first attempt at this was called fixed when it was not.
30e. **Never set the frame's `width` from our own `resize` listener.** Ink already lays the root out to the terminal width; `app.tsx`'s `FullScreen` used to mirror `process.stdout.columns` into React state and pass it as `width`, which made the terminal size two sources of truth updated at different times. Dragging a window edge fires dozens of resize events, Ink writes a frame on each one from the tree as currently committed, and a frame would go out at the previous width while the terminal was already wider — with incremental rendering the stale rows then stayed on screen. That was the missing right border: it survived only on rows left over from a frame written at the right width. A Box with no `width` stretches to the terminal on its own; only `height` needs tracking, and only so the painted background reaches the bottom. Verified by tapping `process.stdout.write`: Ink's bytes were always correct — every line closed with its border — so this is ours, not Ink's.
30d. **Ink wraps a Text that does not fit; it does not clip it.** Section rules used to be `<Text>{'─'.repeat(200)}</Text>` inside a `<Box height={1} overflow="hidden">`. The 200 columns are 200 columns whatever the container is, so the excess ran over the frame's right border and off the row — the right edge of the window disappeared on some rows and not others, and resizing changed which. `overflow="hidden"` on an ancestor does not save you: the Text wraps first. Use `Rule` from `components/text.tsx` (a Box with only a top border, laid out by Yoga) and never a repeat-count that assumes a width. The same trap applies to any padded or centred string built with `repeat`.
30c. **A Box's `backgroundColor` does not reach its border.** Ink draws borders in a separate pass (`render-border.js`), so a framed box paints its interior but leaves the frame's own cells showing whatever is behind them — the terminal's background, which is the one thing the theme is trying not to depend on. Set `borderBackgroundColor` alongside `backgroundColor` on every box that has a border.
30b. **Never use a named colour or `dimColor` in the TUI.** Both are resolved by the terminal's theme, which is why the same screen looked different in every terminal. Import `theme` from `lib/theme.ts` and `Text` from `components/text.tsx` — the wrapper defaults the foreground and remaps `dimColor` — and the app paints its own background in `app.tsx`, so it renders identically on a light terminal too, as a dark panel. `scripts/` and non-UI code are unaffected.
30. **Noise suppression (done; echo cancellation still future)**: RNNoise runs as a `CaptureProcessor` (`audio/noise-suppression.ts`), attached by the engine at join when the `noiseSuppression` setting is on, and off by default. It costs 0.22 ms per 10 ms frame with matching channels and 0.45 ms with a genuinely stereo input — the budget for anything on this path is well under 1 ms, because it runs on the engine's loop at the audio cadence. Echo cancellation is deferred (headphones-first): we push PCM through `RTCAudioSource.onData`, which bypasses libwebrtc's audio processing module entirely, and Windows' driver AEC/Voice Clarity would need `AudioCategory_Communications`, which RtAudio doesn't set. On an RTX machine, NVIDIA Broadcast's virtual microphone gives GPU noise removal and echo cancellation with no code at all — it enumerates as an ordinary WASAPI endpoint, so it already appears in the device picker.
