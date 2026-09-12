# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight, terminal-first audio/video conferencing app. Users create/join rooms from a TUI to talk, share webcam and screen, and send text messages. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (a name of up to 8 cells and a colour, chosen once at first start and kept in settings; both travel with `join-room` so everyone draws `[name]` the same way).

**The client is Go (decided and done 11 Sept 2026).** `packages/go` is one static binary per OS — pion/webrtc, libopus, miniaudio, Bubble Tea — released from GitHub Releases and kept current by its own updater. The Node/Ink client in `packages/terminal` is **retired**: `openmeet-terminal` 0.5.2 is its last npm version, no workflow can publish another, and the package stays in the tree only as the reference the Go interface was drawn from (its golden frames live in `packages/go/internal/tui/testdata`). Why: `docs/performance.md` ("Why the microphone is encoded once") — the codec is not the cost and the language was not the cost; a full libwebrtc PeerConnection per peer is, and `@roamhq/wrtc` took only PCM, so a mesh of six was five encoders for one microphone. pion accepts an RTP packet we already encoded and fans it out to every peer, which keeps the P2P mesh *and* stops paying for it. **Constraints that are not negotiable**: audio stays client-to-client and never passes through a server; screen and camera stay on WebRTC for its congestion control. A server that relays *video* is allowed to be considered — an SFU is the only way the upload stops multiplying by the room — but only if it cannot read what it relays (SFrame, key exchange over the P2P connections we already have); the research is in `docs/backlog.md`. **Priorities, in order**: resource consumption, then audio quality, then screen and camera — anything that costs efficiency is a decision for the user, not a default.

**Platform priorities (decided Sept 2026)**: macOS and Windows first; Linux is paused (keep it compiling, don't invest). **Supported OS releases: Windows 11 and macOS 15 (Sequoia) or later**, on real hardware (`ssh win` for Windows, this Mac for macOS). Windows scope is rooms + audio + chat + screen sharing (ddagrab/NVENC, gdigrab fallback); camera is macOS only for now. **Versioning**: one version number for every platform, in `packages/go/VERSION`; a release is the matching `vX.Y.Z` tag (`go-client.yml` refuses a tag that disagrees). Platform maturity is expressed by the support matrix in the README and the label next to the version on the home screen, not by per-platform versions. 1.0 = macOS/Windows feature parity.

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
- **Media (Go client)**: WebRTC with Opus audio (48 kHz, 20 ms frames, mono at the Audio Send setting — 128 kbps by default, `--audio-kbps` overrides — in-band FEC, **one encoder whose packets go to every peer**) and H.264 video from the GPU encoder (webcam in the camera's own aspect ratio, height ≤ 720; screen in the screen's own aspect ratio, short side ≤ 1080 and long side ≤ 3840, 30 fps; one encoded stream per kind shared by every connection, budget 6000 kbps split by peers, floor 800). The retired Node client spoke stereo Opus with RED and VP8, so Node↔Go rooms carry audio and chat but no video
- **Screen sharing**: Simultaneous webcam + screen share via 3 transceivers per connection

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Client** | Go | 1.25 |
| Client WebRTC | pion/webrtc | v4 |
| Client audio codec | libopus via hraban/opus (cgo, linked statically) | 1.5 |
| Client audio I/O | miniaudio compiled in (`shim.c`); Apple Voice Processing I/O unit on macOS | — |
| Client TUI | Bubble Tea v1 + own cell canvas | — |
| Client video | ffmpeg (VideoToolbox / NVENC / libx264) + ffplay | system |
| Client cross-build | zig (Windows from macOS), cmake (libopus) | — |
| Server runtime | Node.js | >=22 |
| Package Manager | pnpm | latest (workspace monorepo) |
| Server Framework | Express | v5 |
| WebSocket | ws | v8 |
| Storage | In-memory Maps | (no database) |
| IDs | nanoid | v5 |
| Linting/Formatting | Biome | v2.5+ |
| TypeScript | typescript | v6 |
| Retired Node client: TUI | Ink (React 19) | v7 |
| Retired Node client: WebRTC | @roamhq/wrtc (libwebrtc M106) | v0.10 |
| Retired Node client: audio I/O | audify (RtAudio) | v1.10 |
| Retired Node client: bundler | esbuild | v0.28 |
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
│   ├── go-client.yml         # vet/test/build both binaries on macOS; GitHub Release on v* tags
│   ├── ci.yml                # Biome + shared/server build (ubuntu), website build on PRs
│   └── deploy-website.yml    # GitHub Pages deploy of packages/website on push to main
└── packages/
    ├── go/                   # the client: cmd/openmeet + internal/*, VERSION, scripts/ (build, installers)
    ├── shared/               # @openmeet/shared - WS message types
    ├── server/               # @openmeet/server - Express + ws + in-memory Maps
    ├── terminal/             # openmeet-terminal - the retired Node/Ink client, reference only
    └── website/              # @openmeet/website - openmeet.manuelvega.dev, static, en + es
```

## Package: go (`packages/go`)

The client. Module `github.com/manuelvegadev/openmeet/packages/go`, Go 1.25, cgo for libopus (static), miniaudio and the Apple audio unit. `scripts/build.sh` builds for this Mac (libopus once under `.cross/`, `PKG_CONFIG_PATH` absolute — a relative one fell back to Homebrew's dynamic opus), `scripts/build-windows.sh` cross-builds the exe with zig, both stamped from `VERSION`. `go test ./...` runs the unit tests and the golden frames. Full detail, measurements and the release procedure: `packages/go/README.md`.

| Package | Purpose |
|---|---|
| `cmd/openmeet` | Flags (`--server`, `--room`, `--input-device`/`--output-device` by substring, `--list-devices`, `--no-voice-gate`, `--audio-kbps` 64, `--opus-complexity` 10, `--no-voice-processing`, `--voice-processing-bypass`, `--no-priority`, `--no-video`, `--video-device`, `--test-screen`/`--test-camera`, `--headless`, `--debug`, `--cpuprofile`, `--no-auto-update`, `--version`); the settings store and device source the TUI talks to (effects devices — Wave Link FX, NVIDIA Broadcast — labelled and first; a raw Wave mic points at its FX sibling; the Bluetooth note); the updater wiring; the Bubble Tea program fed through an events channel (never `program.Send` before `Run`: it deadlocks) |
| `internal/signal` | The WebSocket protocol, field for field with `packages/shared/src/types.ts`; `Dial`, `Send`, `Incoming` |
| `internal/rtc` | pion: one PeerConnection per peer, three transceivers in order on both offerer and answerer paths, `polite = myID < peerID`, retries, ICE RTTs; Opus PT 111 (`minptime=10;useinbandfec=1`), H.264 PT 102 (`42e01f`, packetization-mode 1); **one `TrackLocalStaticRTP` (audio) and two `TrackLocalStaticSample` (webcam, screen) bound to every connection** — encode once; `LeanInterceptors` (RTCP reports only); the `transport.Net` wrapper marking sockets DSCP EF / `SO_NET_SERVICE_TYPE` voice |
| `internal/audio` | `shim.c` compiles miniaudio in with `MA_NO_*` trims; the device callbacks stay in C and copy into lock-free `ma_pcm_rb` rings — **no audio thread ever enters Go** (a Go callback cost 1.9% for the devices alone against 0.3% in C). `Pump` runs every 20 ms on a locked OS thread at audio priority: capture ring → voice gate (`gate.go`, a port of the Node one, same tests) → Opus (FEC on) → packets with capture-clock timestamps; playout (`playout.go`: per-peer RFC 3550 jitter target 2–6 frames, `DecodeFEC`, PLC, quiet-frame catch-up) → mixer → playback ring prefilled with silence. `vpio_darwin.c` is Apple's Voice Processing I/O unit (Voice Isolation, AEC, gain) as the default macOS path; on Windows the same setting opens the capture in `AudioCategory_Communications`, which is how the endpoint driver's own echo cancellation, noise suppression and gain — and Windows Studio Effects on a machine with an NPU — are asked for (it needs eight marked lines of patch in vendored miniaudio, written down in `internal/audio/miniaudio/PATCHES.md`, because the category can only be set between creating the audio client and initialising it). What that is worth depends on the endpoint: a laptop's microphone usually brings an APO, a USB interface often brings nothing. `agc.go` is ours for those: it levels the voice and nothing else, adapting only while there is a voice to measure. Devices open at their **own** rate and `resample.go` — a port of the Node client's polyphase resampler, 83–89 dB SNR — converts both directions, because miniaudio's own converter is linear interpolation and a 44.1 kHz interface sounded duller through it than through Apple's unit. `om_watch` installs CoreAudio listeners (nominal rate, default devices) **before** opening, miniaudio's stop/reroute notifications cover Windows; either → sleep 300 ms → reopen by name (default fallback) → drain duplicates — this is what keeps a Bluetooth profile switch (44.1 k → 16 k) from turning robotic. Adaptive playback headroom (+20 ms after late ticks, first second ignored). `priority_*.go`: `HIGH_PRIORITY_CLASS` + MMCSS Pro Audio on Windows, QoS user-interactive on macOS |
| `internal/video` | ffmpeg captures and encodes H.264 with the hardware encoder (`-init_hw_device videotoolbox … hwupload,scale_vt` keeps scaling on the GPU: 29% of a core against 103–133% for the CPU chains; NVENC via `ddagrab` D3D11, gdigrab fallback), Annex-B with AUDs split into access units in Go, keyframe every second, 8 s silence watchdog; `Receiver` rebuilds frames with pion's `samplebuilder` and pipes to `ffplay -f h264`. Screens: avfoundation + `system_profiler` names on macOS, PowerShell `AllScreens` on Windows, cached 60 s. `Encoder()` picks videotoolbox / nvenc / amf / qsv / libx264 |
| `internal/tui` | Ink's output, redrawn — with one deliberate exception, the settings screen, which has sections (Audio, Video, Advanced, Other; ←→) and the cost/quality bars under them, so `testdata/settings*.txt` are our own frames rather than Ink's: `canvas.go` (cells, spans, wrap), `theme.go` (the palette from `theme.ts`, `ColorForName`), `chips.go`, `frame.go` (`Centered` with Ink's rounding — centred Text floors, chip rows ceil, an extra row in centred screens), one file per screen, `model.go` (every key the Node client had; the `Room` and `Host` interfaces), `golden_test.go` against `testdata/*.{txt,json}` captured from the Node app at 120x34 — text, colours and bold. Bubble Tea writes only changed lines: 139 B/s in a call |
| `internal/engine` | The room session: dial, rejoin with backoff (1 s → 30 s) as a newcomer, message handling (screen state re-broadcast to joiners, `camOn` on mute-state), stats loop (kbps, RTT, loss, latency), snapshots for the TUI, screen budget |
| `internal/settings` | The same `settings.json` as the Node client, field for field (+ `audioProcessing`), BOM-tolerant |
| `internal/update` | GitHub Releases, asked **on every start** and again on `u` from the home screen (a five-minute floor stops a relaunch asking twice; the stored answer is a fallback for a machine with no network, not a budget). The asset is downloaded beside the exe as `openmeet.new[.exe]`, verified by running it with `--version`, and swapped by rename at exit — Windows renames the running exe to `.old.exe`, cleaned on the next start — with `r` relaunching into it and waiting, because a shell prints its prompt when the process it started exits. An answer that is not a version is refused, cached or fresh: `releases/latest` gives whatever release is newest in the repository, which was the retired npm package's tag until the first binary shipped |
| `scripts/` | `build.sh` (`--deps` stops after libopus, for vet and test), `build-windows.sh`, `install.sh`, `install.ps1`, `win/` (the *optional* Windows Terminal profile and shortcut, the icon, rig launchers). The installers register nothing with the system: no Start Menu entry, no shortcut, no terminal profile — which terminal the app runs in is the user's to choose, and a shortcut would choose for them |

Learnt building it, worth not relearning: a talkspurt ending is not an underrun (count one only if packets resume within 200 ms); the runaway-buffer rule must be relative to the jitter target and sustained a second, then skip quiet frames, never loud ones; `go get golang.org/x/sys@latest` bumped `go.mod` to 1.26 (pinned v0.41.0; `THREAD_PRIORITY_TIME_CRITICAL` is our own const 15); the Apple unit costs 12.9%/6.1% against 2.9% and is on by default by the user's decision ("that cost lands on Apple's processes"); AEC was verified with a BlackHole echo loop (60 kbps → 5 kbps of gate-open audio); the Wave Link and Bluetooth behaviours follow the vendors' documentation, not yet a real friend's machine.

## Package: website (`packages/website`)

The landing page at **openmeet.manuelvega.dev**, private package, never published to npm. Vite 8 (Rolldown + Oxc) with `@vitejs/plugin-react` 6 (no Babel), React 19, TypeScript 7, SCSS (`sass-embedded`, compiled by Vite; `src/styles/site.scss` pulls one partial per area, `_tokens.scss` holds breakpoints and mixins) with the app's palette as CSS custom properties, self-hosted fonts (`@fontsource-variable` IBM Plex Sans for headlines, JetBrains Mono for everything else). Lint and format are the repo's Biome.

**React is a build-time template.** `pnpm --filter @openmeet/website build` runs the client build (CSS, fonts), the SSR build (`src/entry-server.tsx`) and `prerender.mjs`, which writes one complete HTML document per language — `dist/index.html` (en) and `dist/es/index.html` (es) — plus `404.html` and `sitemap.xml`. It finds the stylesheet and the JS to delete in Vite's own `dist/.vite/manifest.json`, so nothing here parses the bundler's HTML. The published page ships no framework: one stylesheet, two woff2 and the page's single inline script. `src/entry-client.tsx` exists for the dev server only (`pnpm --filter @openmeet/website dev`, `/` and `/es/`). `pnpm --filter @openmeet/website check:dist` asserts what came out, reading the page list from the generated sitemap so a new language is covered without editing it.

**The one script is written once.** `src/lib/copy.ts` is the copy buttons' behaviour as a real, type-checked function; `document.tsx` emits it into every page with `` `(${installCopyHandler})()` `` and the dev server calls it directly, so there is no hand-minified twin to drift. Keep that function self-contained — it is serialized with `toString()`.

**Fonts are latin-only.** `src/styles/_fonts.scss` declares the two faces by hand against the `@fontsource-variable` files. Importing the packages whole shipped eleven woff2 (157 KB never fetched) and eleven `@font-face` rules; English and Spanish need one subset each.

**Content and languages.** `src/content/types.ts` is the shape, `en.ts` and `es.ts` the strings, and `src/content/demo.ts` everything that is the same in every language — the demo room's cast and script, the measured install sizes, the chips, the stack. Components read the words through `useCopy()` (`lib/i18n.tsx`) and the rest straight from `demo.ts`, so the two pages cannot drift into showing different demos. English lives at `/` and is the `x-default`; Spanish at `/es/`. Adding a language is a `Copy` file plus an entry in `LANGS`/`PATHS`: `langFromPath` and the header's language links derive from that table rather than naming `es`.

**SEO.** `src/document.tsx` renders the whole `<head>`: title/description per language, canonical, `hreflang` alternates, Open Graph (`public/og.jpg`, 1200×630 from `docs/screenshot.png`) and Twitter cards, and a JSON-LD graph (`SoftwareApplication` with the version read from `packages/terminal/package.json` at build time, `FAQPage` mirroring the visible FAQ, `WebSite`). `public/robots.txt` allows everything including the AI crawlers by name; `public/llms.txt` is the plain-text summary for answer engines. The performance pane quotes measured figures only — install sizes (78 MB against Discord's 479 MB and Chrome's 1.4 GB) and the engine's flat 65 MB — never a total-memory number, for the reason recorded in `docs/performance.md` under "Footprint, measured for the website".

**Deploy.** `deploy-website.yml` runs on pushes to `main` touching `packages/website/**`, then `upload-pages-artifact` → `deploy-pages`. It and `ci.yml`'s `website` job (pull requests only, so a push to `main` does not build the same thing twice) share `.github/actions/build-website`: filtered install (no native modules), type-check, build, `check:dist`. GitHub Pages must be set to source "GitHub Actions"; `public/CNAME` carries the domain, and DNS needs `CNAME openmeet → manuelvegadev.github.io` (the `manuelvega.dev` zone is on Cloudflare with a wildcard, so the record must be explicit, and DNS-only until GitHub has issued the certificate).

## Package: shared (`packages/shared`)

Single source of truth for WebSocket message types as a discriminated union (`WSMessage`).

**Message types**: `join-room`, `room-joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-state`, `screen-share-state`, `chat-message`, `chat-broadcast`, `error`

**Common interfaces**: `Participant` (id, username, joinedAt, optional `color`), `Room` (id, name, createdAt, participantCount). `join-room` and `ChatMessage` carry the same optional `color`; the server copies it from the join onto every chat broadcast, like `username`, so a client never trusts a message's own claim

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

## Package: terminal (`packages/terminal`) — retired, reference only

The Node/Ink client OpenMeet shipped until September 2026, on npm as `openmeet-terminal`
(0.5.2 is the last version; the publish workflow is gone, so nothing can publish another).
It is kept because it is where the Go client came from, not because it is maintained:

- **The interface was drawn from it cell for cell.** `packages/go/internal/tui/testdata`
  holds frames captured from it at 120x34, and `golden_test.go` still compares against them,
  so a change to the Go screens that drifts from the original fails a test. The settings
  screen is the one deliberate exception.
- **Its scripts are working versions of things the Go client ports or still owes**: the voice
  gate (`src/lib/audio/voice-gate.ts` and its test), the channel policy `channels.ts` (the
  Mic Channels item in the backlog), the polyphase resampler `audio/resampler.ts` (ported to
  `internal/audio/resample.go`), the NVIDIA Broadcast matching, the chat panel's tests.
- **Its README opens with the retirement notice**, which is what npm shows.

Nothing in it is built, tested or released any more. Read it for how something was solved;
do not treat it as describing the app.

## CI/CD

### Workflow: `go-client.yml`

On pushes and PRs touching `packages/go/**`, on a macOS runner (the only host that can link CoreAudio; Windows is a zig cross-build from there): `go vet`, `go test ./...`, `build.sh`, `build-windows.sh`, then `openmeet-darwin-arm64`, `openmeet-windows-amd64.exe`, the installers, the Windows Terminal scripts and `SHA256SUMS` as an artifact — and on a `v*` tag, after checking the tag equals `v$(cat packages/go/VERSION)`, a GitHub Release with generated notes (`softprops/action-gh-release`). The client's updater and the installers read `releases/latest`.

### Workflow: `ci.yml`

On every push to `main` and every PR, on ubuntu: `pnpm install`, Biome, `pnpm build` (shared → server). The website job builds the landing page on pull requests. The Node client's three-OS native-module smoke and its script tests left with the client.

### Workflow: `publish-terminal.yml` (removed Sept 2026)

Automated npm publishing of `openmeet-terminal` via GitHub Actions, kept here as the record of how it worked.

- **Trigger**: Push tags matching `terminal-v*` (e.g. `terminal-v0.1.0`)
- **Steps**: checkout → pnpm + Node 22 setup → install → build shared → build terminal → publish to npm → create GitHub Release
- **Auth**: none stored. npm **trusted publishing** — the job's OIDC token (`id-token: write`) is exchanged for publish rights against a trusted publisher configured on npmjs.com for this repository and this workflow's filename. Renaming the file or moving the repo breaks the publish until that is updated to match. The tarball is published `--provenance`, so npm shows which commit and which run built it
- **npm version**: the job installs `npm@latest` first. Trusted publishing needs npm ≥ 11.5.1 and `setup-node` ships whatever npm came with the Node release; `pnpm publish` rewrites the `workspace:` protocol and then delegates to the npm on PATH, so that is the one doing the exchange

### How to publish a new version

```bash
echo 0.6.1 > packages/go/VERSION
git commit -am "chore(go): release 0.6.1"
git tag v0.6.1
git push && git push --tags
# go-client.yml builds both binaries and creates the GitHub Release; clients pick it up within a day
```

The retired flow (`terminal-v*` tags → npm) no longer exists; `npm deprecate openmeet-terminal …` is a one-off in the backlog.

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
| `packages/go/scripts/build.sh && packages/go/openmeet --server ws://localhost:3001/ws` | Build and run the client against the local server |
| `pnpm build` | Build shared → server (order matters) |
| `cd packages/go && go test ./...` | The client's tests, golden frames included |
| `packages/go/scripts/build-windows.sh` | Cross-build the Windows exe |
| `packages/go/openmeet --list-devices` | Validate a machine's audio stack without joining a room |
| `pnpm lint` | `biome check .` |
| `pnpm lint:fix` | `biome check --write .` |
| `pnpm format` | `biome format --write .` |

## Docker

- **Multi-stage build**: `node:22-alpine`, builds only `shared` + `server` (`pnpm install --filter "@openmeet/server..."` skips the terminal's native `@roamhq/wrtc` build)
- **pnpm prune**: Must use `CI=true pnpm prune --prod` (non-TTY environment)
- **Production**: Single container serves the REST API + WebSocket signaling on port 3001

## Known Gotchas

Things that cost a day to learn. Everything here applies to the client we ship unless it
says otherwise; what was specific to the retired Node client went with it.

### The room and the connection

1. **Three transceivers, same order, both sides**: audio (0), webcam (1), screen (2),
   created before the offer and bound before the answer. Do not reorder or skip: the m-lines
   are matched by position.
2. **Audio is `sendrecv` even while muted.** Anything else and the remote `OnTrack` never
   fires, so a peer's state is unknown until they speak.
3. **Screen share state is a WebSocket broadcast, not a renegotiation**, and it is
   re-broadcast whenever the participant count changes so a newcomer learns who is sharing.
   When it goes false, watchers close that peer's window.
4. **STUN is Google's public servers.** A restrictive NAT on both ends needs a TURN server,
   which is not included.
5. **Joining a room that does not exist creates it** (`ensureRoom` on `join-room`), so a typo
   is a room of your own. In the backlog.
6. **Do not measure a peer on the same machine.** On macOS loopback the sender's `sendto`
   does the receiver's delivery in the sender's context, so a loopback peer charges its cost
   to whoever you are measuring.

### Audio

7. **No audio thread may ever enter Go.** The device callbacks are C, copying into lock-free
   rings; a Go callback measured 1.9% of a core for the devices alone against 0.3% in C. The
   pump goroutine wakes every 20 ms, locked to its own thread at audio priority, and does
   capture → gate → encode → send and playout → mixer → ring.
8. **A device's own rate is the rate to open it at.** miniaudio's converter is linear
   interpolation, and a Roland at 44.1 kHz through it sounded audibly duller than the same
   microphone through Apple's unit. `internal/audio/resample.go` converts instead, 83–89 dB.
9. **A talkspurt ending is not an underrun.** Count one only if packets resume within 200 ms;
   otherwise every sentence ends in a false alarm.
10. **The runaway-buffer rule is relative to the jitter target, sustained for a second, and
    then skips quiet frames** — never loud ones. Anything simpler either never catches up or
    clicks.
11. **The system's voice processing has to be in force before any device opens**, not only on
    the way into a room: the device picker's mic test goes through the same pump, so it would
    otherwise let you compare the wrong two things.
12. **Finding an audio bug that only ears can hear**: put a known signal in (a tone through
    a virtual device such as BlackHole), record what comes out on the *other* machine through
    a loopback device, and compare. A dump of the mix cannot see playback-stage bugs, and a
    pure tone hides time-stretching — use speech when the complaint is about speech.

### Video

13. **`-video_size` is a demand, not a request.** A camera without that exact mode fails to
    open at all (`Input/output error`), so the camera is opened at whatever it offers and
    scaled in a filter. Pinning the mode is also what makes a camera reconfigured underneath
    us come out combed: measured, not pinning costs nothing with `-sws_flags fast_bilinear`.
14. **A camera opens once on macOS**, and the error for "someone else has it" is
    `Input/output error`. Our own preview and our own capture are two openers: releasing one
    has to *complete* before the other starts, not merely be asked for.
15. **avfoundation ignores `-framerate` for screens** (use `-r` on the output) and rejects
    rates it lists as supported for cameras (use 30). `-list_devices` exits non-zero by
    design: capture stderr, do not treat the status as failure.
16. **macOS screen capture fails by being silent.** ffmpeg keeps running at ~20% of a core
    and never writes a byte — no permission for the hosting app, or ScreenCaptureKit wedged,
    which is *per hosting app* and only quitting it clears. `screencapture -x /tmp/t.png` is
    the discriminator. Eight seconds without data ends the share with the reason in the room
    log.
17. **`ddagrab` needs a real GPU output and no GPU scaler works.** Inside RDP it fails with
    `Failed to enumerate DXGI output 0` while gdigrab captures that session fine, hence the
    fallback; `scale_d3d11`, `hwmap` to CUDA and to Vulkan all fail on this build. So the
    NVENC path sends the screen at its own size, and `dup_frames=false` is what makes a still
    desktop cost 3% instead of 41%. Never put `-r` on the output: it restores the duplication.
18. **The video paths are audio work.** Anything that delays the 20 ms pump is an audible
    gap, so video capture, encode and send stay on their own goroutines and the pump never
    waits on them.

### Windows

19. **Config lives in `%APPDATA%\openmeet`, and a `settings.json` written by Notepad or
    PowerShell carries a UTF-8 BOM** that `JSON.parse`/`json.Unmarshal` refuse — strip it, or
    every saved setting is silently lost. The same trap applies to any JSON read there.
20. **Screen capture needs the interactive desktop.** A process started over SSH lives in
    session 0 and sees a fake 1024x768 display; `schtasks /create … /it` + `/run` puts it in
    the user's session, which only has a display while that session is connected. Audio over
    SSH is fine; only capture needs the desktop.
21. **Explorer's PATH is stale**, so never spawn a tool by bare name: a window opened from a
    desktop shortcut inherits the environment Explorer started with, which usually lacks
    `%LOCALAPPDATA%\Microsoft\WinGet\Links` where winget puts ffmpeg. `internal/video`
    resolves the tools itself and the log says where they were found.
22. **NVIDIA Broadcast is detected, not integrated.** Its virtual microphone is a plain WASAPI
    endpoint; there is no SDK and nothing to link. Match `/nvidia broadcast/i` and never
    `/nvidia/i` — the same machines list `NVIDIA High Definition Audio` and `NVIDIA Virtual
    Audio Device`, and a false positive would turn off processing someone asked for.
23. **`IP_TOS` is ignored on Windows** without a machine-wide QoS policy; marking there needs
    the qWAVE API, per destination. In the backlog.

### The interface

24. **The TUI's cost is how often something changes, not how much is on screen.** Before
    adding anything that updates continuously — a clock with seconds, a meter, a spinner —
    price it at one repaint per update and put it behind a change a person would notice. The
    VU meter was retired for exactly this: 8.5 full repaints a second to draw a bar.
25. **The speaking dot is the voice gate, and the voice gate is the send path.** While it is
    shut nothing is encoded here, sent to anyone, or decoded anywhere in the room, and mute
    holds it shut *without feeding it*, so a long mute cannot teach it that the room is
    silent.
26. **Bubble Tea deadlocks if you `Send` before `Run`.** Events go through a channel and a
    forwarder goroutine, and emitting is non-blocking.
27. **The golden frames are the contract**, not a snapshot to regenerate when a test fails:
    they came from the Node client and they are why the two look alike. Regenerating one is a
    decision to diverge, which the settings screen made on purpose.

### Building and releasing

28. **pkg-config paths must be absolute.** A relative `PKG_CONFIG_PATH` resolves from the
    package directory and quietly falls back to Homebrew's dynamic libopus; `otool -L` on the
    binary is the check.
29. **`go get golang.org/x/sys@latest` bumps `go.mod` to a Go version we do not target.**
    Pinned to v0.41.0; `THREAD_PRIORITY_TIME_CRITICAL` is our own constant.
30. **The vendored miniaudio carries one patch of ours**, eight lines marked
    `/* OpenMeet patch */` and written down in `internal/audio/miniaudio/PATCHES.md`. Re-apply
    it on any upgrade, or Windows silently loses its voice processing.
31. **A release is the tag and `packages/go/VERSION` agreeing.** The binary reports VERSION
    and the updater compares it with the tag it downloaded, so a mismatch would loop; CI
    refuses the tag instead.
32. **`pnpm prune` in Docker needs `CI=true`** for a non-interactive environment, and the
    shared package must build before the server.
