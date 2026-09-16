# OpenMeet - Project Context for Claude Code

## Overview

OpenMeet is a lightweight, terminal-first audio/video conferencing app. Users create/join rooms from a TUI to talk, share webcam and screen, and send text messages. P2P mesh topology (max 6 participants), WebSocket signaling, in-memory Maps (no database), no authentication (a name of up to 8 cells and a colour, chosen once at first start and kept in settings; both travel with `join-room` so everyone draws `[name]` the same way).

**The client is Go (decided and done 11 Sept 2026).** `packages/go` is one static binary per OS — pion/webrtc, libopus, miniaudio, Bubble Tea — released from GitHub Releases and kept current by its own updater. The Node/Ink client is **retired and gone from the tree** (removed 12 Sept 2026): `openmeet-terminal` 0.5.2 is its last npm version and no workflow can publish another. Git keeps it at its tag — `git show terminal-v0.5.2:packages/terminal/...`, `git grep <pattern> terminal-v0.5.2` — which is where the two backlog items that still owe it code now point. The interface it defined lives on as the golden frames in `packages/go/internal/tui/testdata`, which are self-contained. Why: `docs/performance.md` ("Why the microphone is encoded once") — the codec is not the cost and the language was not the cost; a full libwebrtc PeerConnection per peer is, and `@roamhq/wrtc` took only PCM, so a mesh of six was five encoders for one microphone. pion accepts an RTP packet we already encoded and fans it out to every peer, which keeps the P2P mesh *and* stops paying for it. **Constraints that are not negotiable**: audio stays client-to-client and never passes through a server; screen and camera stay on WebRTC for its congestion control. A server that relays *video* is allowed to be considered — an SFU is the only way the upload stops multiplying by the room — but only if it cannot read what it relays (SFrame, key exchange over the P2P connections we already have); the research is in `docs/backlog.md`. **Priorities, in order**: resource consumption, then audio quality, then screen and camera — anything that costs efficiency is a decision for the user, not a default.

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
- **Signaling**: WebSocket for SDP/ICE exchange, chat messages, mute state, screen share state, and file offers (the description of a file, never the file)
- **Media (Go client)**: WebRTC with Opus audio (48 kHz, 20 ms frames, mono at the Audio Send setting — 128 kbps by default, `--audio-kbps` overrides — in-band FEC, **one encoder whose packets go to every peer**) and H.264 video from the GPU encoder (webcam in the camera's own aspect ratio, height ≤ 720; screen in the screen's own aspect ratio, short side ≤ 1080 and long side ≤ 3840, 30 fps; one encoded stream per kind shared by every connection, budget 6000 kbps split by peers, floor 800). The retired Node client spoke stereo Opus with RED and VP8, so Node↔Go rooms carry audio and chat but no video
- **Screen sharing**: Simultaneous webcam + screen share via 3 transceivers per connection
- **Files**: announced over the WebSocket, fetched over an SCTP data channel on the same peer connection — never pushed, never through the server. One `control` channel per connection (created by the offerer, after the three transceivers), then a channel of its own per transfer. Received files land in `~/Downloads/openmeet`. **The voice has priority and a QoS mark cannot give it**: SCTP and SRTP share one socket and one DSCP mark, so the transfer's ceiling follows the peer's round trip over its own baseline instead — the `File Transfer` setting picks `voice-first` (default), `unlimited` or `capped`

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
| Package Manager | pnpm | workspace of two: server + website |
| Server Framework | Express | v5 |
| WebSocket | ws | v8 |
| Storage | In-memory Maps | (no database) |
| IDs | nanoid | v5 |
| Linting/Formatting | Biome | v2.5+ |
| TypeScript | typescript | v6 |
| CI/CD | GitHub Actions | — |

## Monorepo Structure

```
openmeet/
├── package.json              # Root workspace scripts
├── pnpm-workspace.yaml       # an explicit list: packages/server, packages/website
├── biome.json                # Shared Biome config
├── Dockerfile                # Multi-stage build (server only)
├── docker-compose.yml        # Single service, port 3001
├── CHANGELOG.md              # Keep a Changelog 1.1.0; the GitHub releases copy its sections
├── CONTRIBUTING.md           # Commits, branches, pre-push checks, and the release procedure
├── docs/                     # Architecture docs
├── .github/workflows/        # CI/CD workflows
│   ├── go-client.yml         # vet/test/build both binaries on macOS; GitHub Release on v* tags
│   ├── lint.yml              # Biome over both packages; the root install alone
│   ├── server.yml            # the server's type-check, and the image builds
│   ├── website.yml           # the website build, pull requests only
│   └── deploy-website.yml    # GitHub Pages deploy of packages/website on push to main
└── packages/
    ├── go/                   # the client: cmd/openmeet + internal/*, VERSION, scripts/ (build, installers)
    ├── server/               # @openmeet/server - Express + ws + in-memory Maps + protocol.ts
    └── website/              # @openmeet/website - openmeet.manuelvega.dev, static, en + es
```

## Package: go (`packages/go`)

The client. Module `github.com/manuelvegadev/openmeet/packages/go`, Go 1.25, cgo for libopus (static), miniaudio and the Apple audio unit. `scripts/build.sh` builds for this Mac (libopus once under `.cross/`, `PKG_CONFIG_PATH` absolute — a relative one fell back to Homebrew's dynamic opus), `scripts/build-windows.sh` cross-builds the exe with zig, both stamped from `VERSION`. `go test ./...` runs the unit tests and the golden frames. Full detail, measurements and the release procedure: `packages/go/README.md`.

| Package | Purpose |
|---|---|
| `cmd/openmeet` | Flags (`--server`, `--room`, `--input-device`/`--output-device` by substring, `--list-devices`, `--no-voice-gate`, `--audio-kbps` and `--opus-complexity` (both 0 — meaning the saved setting, 128 kbps and 10, stands), `--no-voice-processing`, `--voice-processing-bypass`, `--no-priority`, `--no-video`, `--video-device`, `--test-screen`/`--test-camera`, `--headless` with `--send-file`/`--accept-files`/`--share-screen`, `--demo` (a scripted room with no server, devices or network — the interface as it really draws, which is what a design change is judged on and where a screenshot comes from), `--logs`/`--grep`/`--all` (follow the debug log `--debug` writes beside settings.json), `--debug`, `--cpuprofile`, `--no-auto-update`, `--version`); the settings store and device source the TUI talks to (effects devices — Wave Link FX, NVIDIA Broadcast — labelled and first; a raw Wave mic points at its FX sibling; the Bluetooth note); the updater wiring; the Bubble Tea program fed through an events channel (never `program.Send` before `Run`: it deadlocks) |
| `internal/signal` | The WebSocket protocol, field for field with `packages/server/src/protocol.ts`; `Dial`, `Send`, `Incoming` |
| `internal/rtc` | pion: one PeerConnection per peer, three transceivers in order on both offerer and answerer paths, `polite = myID < peerID`, retries, ICE RTTs; Opus PT 111 (`minptime=10;useinbandfec=1`), H.264 PT 102 (`42e01f`, packetization-mode 1); **one `TrackLocalStaticRTP` (audio) and two `TrackLocalStaticSample` (webcam, screen) bound to every connection** — encode once; `LeanInterceptors` (RTCP reports only); the `transport.Net` wrapper marking sockets DSCP EF / `SO_NET_SERVICE_TYPE` voice. `data.go` is the data channels, detached (`se.DetachDataChannels()`): the offerer creates `control` in `addContract` *after* the transceivers, so every offer is audio 0, webcam 1, screen 2, control 3; a file then gets a channel of its own labelled `file:<id>`, which costs no renegotiation because SCTP is already up. `LocalPair` reads the nominated candidate pair — host↔host with a private address means the local network, which is what decides a transfer's rate |
| `internal/files` | Sharing a file, with no network in it: `Kind` (aud/vid/img/zip/doc by extension), `Describe` (size + SHA-256), `Send`/`Receive` (16 KiB chunks, a token bucket, `.part` until the digest checks out, and a refusal to take more than was offered), `SafeName`/`Destination` (a peer chose that name and none of it is trusted: no path parts, no reserved device names, no trailing dots, numbered rather than overwritten), `Attach` (a dropped path as each terminal escapes it — backslashes on Unix, quotes on Windows Terminal, all of them or none), `Clipboard` (osascript on macOS, PowerShell over `-EncodedCommand` on Windows), and `Open`/`Reveal`/`Preview` — Quick Look on macOS, and on Windows, which has none, the default application |
| `internal/audio` | `shim.c` compiles miniaudio in with `MA_NO_*` trims; the device callbacks stay in C and copy into lock-free `ma_pcm_rb` rings — **no audio thread ever enters Go** (a Go callback cost 1.9% for the devices alone against 0.3% in C). `Pump` runs every 20 ms on a locked OS thread at audio priority: capture ring → voice gate (`gate.go`, a port of the Node one, same tests) → Opus (FEC on) → packets with capture-clock timestamps; playout (`playout.go`: per-peer RFC 3550 jitter target 2–6 frames, `DecodeFEC`, PLC, quiet-frame catch-up) → mixer → playback ring prefilled with silence. `vpio_darwin.c` is Apple's Voice Processing I/O unit (Voice Isolation, AEC, gain) as the default macOS path; on Windows the same setting opens the capture in `AudioCategory_Communications`, which is how the endpoint driver's own echo cancellation, noise suppression and gain — and Windows Studio Effects on a machine with an NPU — are asked for (it needs eight marked lines of patch in vendored miniaudio, written down in `internal/audio/miniaudio/PATCHES.md`, because the category can only be set between creating the audio client and initialising it). What that is worth depends on the endpoint: a laptop's microphone usually brings an APO, a USB interface often brings nothing. `agc.go` is ours for those: it levels the voice and nothing else, adapting only while there is a voice to measure. Devices open at their **own** rate and `resample.go` — a port of the Node client's polyphase resampler, 83–89 dB SNR — converts both directions, because miniaudio's own converter is linear interpolation and a 44.1 kHz interface sounded duller through it than through Apple's unit. `om_watch` installs CoreAudio listeners (nominal rate, default devices) **before** opening, miniaudio's stop/reroute notifications cover Windows; either → sleep 300 ms → reopen by name (default fallback) → drain duplicates — this is what keeps a Bluetooth profile switch (44.1 k → 16 k) from turning robotic. Adaptive playback headroom (+20 ms after late ticks, first second ignored). `priority_*.go`: `HIGH_PRIORITY_CLASS` + MMCSS Pro Audio on Windows, QoS user-interactive on macOS |
| `internal/video` | ffmpeg captures and encodes H.264 with the hardware encoder (`-init_hw_device videotoolbox … hwupload,scale_vt` keeps scaling on the GPU: 29% of a core against 103–133% for the CPU chains; NVENC via `ddagrab` D3D11, gdigrab fallback), Annex-B with AUDs split into access units in Go, keyframe every second, 8 s silence watchdog; `Receiver` rebuilds frames with pion's `samplebuilder` and pipes to `ffplay -f h264`. Screens: avfoundation + `system_profiler` names on macOS, PowerShell `AllScreens` on Windows, cached 60 s. `Encoder()` picks videotoolbox / nvenc / amf / qsv / libx264 |
| `internal/tui` | Ink's output, redrawn — with two deliberate exceptions. **The room's conversation is ours**: `bubbles.go` draws a message as a box on the side it came from (yours right in the accent, theirs left in grey, the name and the time on the outer edge), a run from one person in one box (same sender, two minutes, anything in between closes it), a file as a card across the whole width with its buttons inside it, and a room event centred and plain. Bubbles are 80% of the column, and the whole of it below 60 cells, the way a phone draws a conversation; the composer floats in a rounded box off the pane's bottom edge; below `MinWidth`×`MinHeight` the room is not drawn squeezed, it says the window is too small. The other exception is the settings screen, which has sections (Audio, Video, Advanced, Other; ←→) and the cost/quality bars under them, so `testdata/settings*.txt` are our own frames rather than Ink's: `canvas.go` (cells, spans, wrap), `theme.go` (the palette from `theme.ts`, `ColorForName`, and `SetTheme`: the accent, its tone, the background, the borders and the corners are the user's — Settings ▸ Look — and everything else on screen is derived from those five there, once, so no screen knows a theme exists; the values are package variables written only by `SetTheme`, from the goroutine that draws, and the defaults are what every golden frame is drawn in. `Accents` is `NamePalette`'s thirteen colours in the same order and at the same values, so the room has one palette and not two — yellow is the single exception, at the accent's own #E8B900, and a test holds the two lists together. A tone moves saturation and lightness in HSL and never the hue, and `readable` then walks the lightness away from the ground until 3:1, which is the only reason a pastel is legible on white), `chips.go`, `frame.go` (the border set `B` — single or double, rounded or square, complete in every weight so a divider meeting a rule has a tee of its own, and double is square whatever the corner says because Unicode has no rounded double corner — the one `Box` and `Rule` every panel in the interface is drawn through, and `Centered` with Ink's rounding — centred Text floors, chip rows ceil, an extra row in centred screens), one file per screen, `model.go` (every key the Node client had; the `Room` and `Host` interfaces), `golden_test.go` against `testdata/*.{txt,json}` captured from the Node app at 120x34 — text, colours and bold; the room's three are ours, regenerated on purpose by `OPENMEET_REGEN=1 go test ./internal/tui -run GenerateRoomGoldens`, which is a decision to change the design and not a way to make a red test green. Bubble Tea writes only changed lines: 139 B/s in a call. The mouse is mode 1002 (`hitmap.go`, `mouse.go`): screens register what they draw as they draw it — `DrawHints` every chip, `DrawSelect` every row, `DrawTabs` every tab — and a click **sends the key the chip already shows** through the ordinary key handler, so nothing is stated twice and a disabled chip registers nothing. the composer's attachment chips and the files list `f` opens live in `files.go` beside them; `selection.go` is our own selection, two positions in the conversation rather than cells on screen, bridged by the offsets `WrapOffsets` records: it can only contain text, and a wrapped message copies as one line. `toast.go` is the notice row over the composer, which is also where the key that copies a selection is shown. The composer is a text field: it wraps and grows upward as a draft does, up to six rows or a third of the pane, then scrolls with the cursor (`wrapDraft`, which unlike `Wrap` keeps every rune — an editor may not drop what was typed), and it is a selectable region like the log, so the caret follows a click and what is selected is what a backspace or a paste replaces |
| `internal/engine` | The room session: dial, rejoin with backoff (1 s → 30 s) as a newcomer, message handling (screen state re-broadcast to joiners, `camOn` on mute-state), stats loop (kbps, RTT, loss, latency), snapshots for the TUI, screen budget. `files.go` is the file half: offer, serve on request, take only a file we asked for from the peer who offered it, and mark a leaver's offers gone |
| `internal/logs` | The debug log: one file beside `settings.json`, capped at 4 MB and trimmed to its newest half, written from its own goroutine so nothing ever waits on a disk. `Follow` is `--logs`, opening on the last 200 lines and following across a trim; `OpenWindow` opens it in the terminal this session is already in (`TERM_PROGRAM`, `WT_SESSION`) and hands back the command when it is one it does not know — it never picks a terminal for you |
| `internal/settings` | The same `settings.json` as the Node client, field for field (+ `audioProcessing`, `mouse`, `copyOnSelect`, `fileTransfer`, and the five appearance keys `accent`/`tone`/`background`/`borders`/`corners`), BOM-tolerant |
| `internal/keyboard` | The kitty keyboard protocol, for the one thing the legacy encoding cannot express: a chord with Cmd in it. A `Reader` between the tty and Bubble Tea asks the terminal (`CSI ? u`), turns the protocol on where it answers (`CSI = 1 u`), and translates what that changes — `Esc` becomes `CSI 27 u`, `Ctrl+C` becomes `CSI 99;5u` — back into the bytes Bubble Tea has always been handed, keeping `Cmd+C` (`CSI 99;9u`), which never had any. Measured in Ghostty, not read off a spec |
| `internal/clip` | The clipboard: OSC 52 through the renderer's own writer always — the only route home from a session over SSH — plus `pbcopy`/PowerShell/`wl-copy` when the session is local. Apple's Terminal is the one terminal here that ignores OSC 52, and is covered by `pbcopy` |
| `internal/update` | GitHub Releases, asked **on every start** and again on `u` from the home screen (a five-minute floor stops a relaunch asking twice; the stored answer is a fallback for a machine with no network, not a budget). The asset is downloaded beside the exe as `openmeet.new[.exe]`, verified by running it with `--version`, and swapped by rename at exit — Windows renames the running exe to `.old.exe`, cleaned on the next start — with `r` relaunching into it and waiting, because a shell prints its prompt when the process it started exits. An answer that is not a version is refused, cached or fresh: `releases/latest` gives whatever release is newest in the repository, which was the retired npm package's tag until the first binary shipped |
| `scripts/` | `build.sh` (`--deps` stops after libopus, for vet and test), `build-windows.sh`, `install.sh`, `install.ps1`, `win/` (the *optional* Windows Terminal profile and shortcut, the icon, rig launchers). The installers register nothing with the system: no Start Menu entry, no shortcut, no terminal profile — which terminal the app runs in is the user's to choose, and a shortcut would choose for them |

Learnt building it, worth not relearning: a talkspurt ending is not an underrun (count one only if packets resume within 200 ms); the runaway-buffer rule must be relative to the jitter target and sustained a second, then skip quiet frames, never loud ones; `go get golang.org/x/sys@latest` bumped `go.mod` to 1.26 (pinned v0.41.0; `THREAD_PRIORITY_TIME_CRITICAL` is our own const 15); the Apple unit costs 12.9%/6.1% against 2.9% and is on by default by the user's decision ("that cost lands on Apple's processes"); AEC was verified with a BlackHole echo loop (60 kbps → 5 kbps of gate-open audio); the Wave Link and Bluetooth behaviours follow the vendors' documentation, not yet a real friend's machine.

## Package: website (`packages/website`)

The landing page at **openmeet.manuelvega.dev**, private package, never published to npm. Vite 8 (Rolldown + Oxc) with `@vitejs/plugin-react` 6 (no Babel), React 19, TypeScript 7, SCSS (`sass-embedded`, compiled by Vite; `src/styles/site.scss` pulls one partial per area, `_tokens.scss` holds breakpoints and mixins) with the app's palette as CSS custom properties, self-hosted fonts (`@fontsource-variable` IBM Plex Sans for headlines, JetBrains Mono for everything else). Lint and format are the repo's Biome.

**React is a build-time template.** `pnpm --filter @openmeet/website build` runs the client build (CSS, fonts), the SSR build (`src/entry-server.tsx`) and `prerender.mjs`, which writes one complete HTML document per language — `dist/index.html` (en) and `dist/es/index.html` (es) — plus `404.html` and `sitemap.xml`. It finds the stylesheet and the JS to delete in Vite's own `dist/.vite/manifest.json`, so nothing here parses the bundler's HTML. The published page ships no framework: one stylesheet, two woff2 and the page's single inline script. `src/entry-client.tsx` exists for the dev server only (`pnpm --filter @openmeet/website dev`, `/` and `/es/`). `pnpm --filter @openmeet/website check:dist` asserts what came out, reading the page list from the generated sitemap so a new language is covered without editing it: the structured data, the canonical and hreflang links, the analytics beacon, no stray JavaScript in `assets/`, and the Look panel's thirteen swatches with its early script in the `<head>`.

**The scripts are written once.** `src/lib/copy.ts` is the copy buttons' behaviour and `src/lib/theme.ts` the Look panel's, both as real, type-checked functions; `document.tsx` emits them into every page with `` `(${installCopyHandler})()` `` and the dev server calls them directly, so there is no hand-minified twin to drift. Keep those functions self-contained — they are serialized with `toString()`. There are **two** inline scripts and the split is deliberate: `installSavedLook` is in the `<head>`, because a visitor who chose a light page must not be shown a dark one first, and it only replays the colours the panel already saved rather than carrying any colour rules; everything else runs at the end of the body.

**The Look panel is the app's Look settings.** Same thirteen accents, same three tones, same background/borders/corners, same rules — `src/lib/theme.ts` is a TypeScript port of `packages/go/internal/tui/theme.go` (HSL tone, the 3:1 floor under it, the text on the accent). The ground is plain CSS: `data-background` on `<html>` swaps a block of custom properties in `_look.scss`, so nothing else on the page knows a theme exists. The accents' table is the part that would drift, so a Go test — `TestTheWebsitePaletteMatches` in `internal/tui` — reads `ACCENTS` out of the TypeScript and fails if it no longer matches `tui.Accents`; keep the table one entry per line, `{ name, hex, alt }`.

**The terminal is exported from the application, not written by hand.** `src/content/terminal.json` is produced by `TestWebsiteTerminal` in `packages/go/internal/tui`, which plays the app's own `--demo` (`internal/demo`, shared with `cmd/openmeet`) against a 138×33 canvas and writes out what the room drew: the frame once, then every rectangle of it that moves — the header, the participants, the composer, the draft and each block of the conversation — as a list of versions with the moment each takes over. Regenerate with `OPENMEET_REGEN=1 go test ./internal/tui -run WebsiteTerminal`; `TestWebsiteTerminalIsCurrent` runs the same export and compares, so **changing how the room draws without regenerating fails the Go build, not the landing page**. Three things make it work. Colours go out as *names* (`accent`, `muted`, `name-cyan`), so `_tui.scss` decides what they are and the Look panel still reaches inside the terminal — a colour the theme cannot name fails the export rather than reaching the page unpaintable. The conversation is exported as the app's own blocks (`logRowsUpTo` in `bubbles.go`), stacked against the bottom of the pane and clipped at the top, which is how the room fills it; a block that grew — a second message joining the bubble above it, a transfer moving its bar — is a new version of that block and nothing else moves. And the frame is *characters*, so double borders and square corners are ten glyphs swapped by `lib/theme.ts` rather than a CSS border. About 3 KB gzipped for thirty-six seconds, with no JavaScript: React is a build-time template and the timings are `animation-delay`. `check:dist` holds the whole page under 25 KB gzipped, because the one thing here that could grow unnoticed is the thing a machine writes. The demo types its own messages (`demo.TypeInto` → the `tui.Draft` event), which is why the composer is shown being written in; the exporter turns those keystrokes into one `steps()` reveal instead of a frame each.

**Fonts: two latin subsets and one of ours.** `src/styles/_fonts.scss` declares the faces by hand against the `@fontsource-variable` files. Importing the packages whole shipped eleven woff2 (157 KB never fetched) and eleven `@font-face` rules; English and Spanish need one subset each. The third face is `src/fonts/jetbrains-mono-box.woff2` (3.7 KB, cut from the upstream family — `src/fonts/README.md` has the command and OFL.txt the licence): **no fontsource subset carries box drawing**, so `╭ ─ │ █ ●` fell through to the machine's own monospace at 0.60205 em against JetBrains Mono's 0.600, and a terminal is a grid — a row of frame came out 3.6 px wider than a row of text with no two vertical edges in line. Same family name, disjoint `unicode-range`, `font-display: block` on that one alone, because a frame in a fallback is a frame at the wrong width. `TestWebsiteTerminal` fails the export on any character outside the two ranges. The terminal's row pitch is **1.32 em** and not a matter of taste: it is the line height JetBrains Mono declares (ascender 1020 + descender 300 per 1000 upem), so it is the cell Ghostty and every other terminal builds from this font, and the font draws `│` 1.52 em tall — 0.1 em proud at each end — which is what makes a vertical rule continuous rather than a column of dashes. Vite is told never to inline a font (`assetsInlineLimit`): under its 4 KB default the subset went in as 5 KB of base64, in both pages, which does not compress.

**Content and languages.** `src/content/types.ts` is the shape, `en.ts` and `es.ts` the strings, and `src/content/demo.ts` what is the same in every language — the participant rows the story panes draw, the measured install sizes, the chips, the stack. The terminal is in neither: it comes out of the application, which has no languages, so a Spanish visitor is shown the English interface they would actually download. Components read the words through `useCopy()` (`lib/i18n.tsx`) and the rest straight from `demo.ts`, so the two pages cannot drift into showing different demos. English lives at `/` and is the `x-default`; Spanish at `/es/`. Adding a language is a `Copy` file plus an entry in `LANGS`/`PATHS`: `langFromPath` and the header's language links derive from that table rather than naming `es`.

**SEO.** `src/document.tsx` renders the whole `<head>`: title/description per language, canonical, `hreflang` alternates, Open Graph (`public/og.jpg`, 1200×630 from `docs/screenshot.png`) and Twitter cards, and a JSON-LD graph (`SoftwareApplication` with the version read from `packages/go/VERSION` at build time, `FAQPage` mirroring the visible FAQ, `WebSite`). `public/robots.txt` allows everything including the AI crawlers by name; `public/llms.txt` is the plain-text summary for answer engines. The performance pane quotes measured figures only — install sizes (the 12 MB binary against Discord's 479 MB and Chrome's 1.4 GB) and the engine's flat 65 MB — never a total-memory number, for the reason recorded in `docs/performance.md` under "Footprint, measured for the website".

**Deploy.** `deploy-website.yml` runs on pushes to `main` touching `packages/website/**`, then `upload-pages-artifact` → `deploy-pages`. It and `website.yml` (pull requests only, so a push to `main` does not build the same thing twice) share `.github/actions/build-website`: install of that package alone, type-check, build, `check:dist`. GitHub Pages must be set to source "GitHub Actions"; `public/CNAME` carries the domain, and DNS needs `CNAME openmeet → manuelvegadev.github.io` (the `manuelvega.dev` zone is on Cloudflare with a wildcard, so the record must be explicit, and DNS-only until GitHub has issued the certificate).

## The WebSocket protocol

`packages/server/src/protocol.ts` declares every message as a discriminated union (`WSMessage`).
It is **one half of the contract**: the other is `packages/go/internal/signal`, which declares
the same messages field for field. Go cannot import TypeScript, so nothing mechanical keeps them
in step — changing one without the other is how a room goes quiet with no error anywhere. Adding
an optional field is safe in both directions, since the client updates itself while the server is
deployed separately; renaming or repurposing one is not.

**Message types**: `join-room`, `room-joined`, `participant-joined`, `participant-left`, `offer`, `answer`, `ice-candidate`, `mute-state`, `screen-share-state`, `chat-message`, `chat-broadcast`, `file-offer`, `file-offer-broadcast`, `error`

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
| `src/files.ts` | File offer broadcasting — the description only. The server never holds a file, never sees one, and keeps no record that one exists |
| `src/types.ts` | `ConnectedClient` (ws, participantId, roomId, username) |

### REST API

- `GET /api/rooms` — list all rooms
- `POST /api/rooms` — create room (body: `{ name }`). Unused by the TUI, which lets `join-room` create the room; a room created here and never joined is never collected, because `removeParticipant` only sweeps on disconnect
- `GET /api/rooms/:id` — get single room

### WebSocket signaling flow

1. Client sends `join-room` → server adds to in-memory map, responds with `room-joined` (includes `yourId` + existing participants), broadcasts `participant-joined` to others
2. Signaling messages (`offer`, `answer`, `ice-candidate`) → forwarded directly to target peer by `toId`
3. `mute-state` and `screen-share-state` → broadcast to all other room members
4. `chat-message` → broadcast as `chat-broadcast` to all room members; `file-offer` → broadcast as `file-offer-broadcast` the same way, sender included, with `fromId`/`username`/`color` set from the connection
5. On disconnect → broadcast `participant-left`, remove from map. If room is empty, remove room.

### Important server details

- **Room limit**: 6 participants max, enforced on `join-room`
- **Keepalive**: Server pings all WebSocket clients every 25s to survive reverse proxies
- **No static files**: The server only exposes the REST API and `/ws`. There is no web client.

## WebRTC, and what must not change

The connection contract — three transceivers in the order audio, webcam, screen; audio
`sendrecv` even while muted so the remote `OnTrack` fires; `polite = myID < peerID` for glare;
retries by the impolite peer only; screen-share state as a WebSocket broadcast rather than a
renegotiation — is set out for the client we ship in
[`docs/websocket-webrtc-architecture.md`](docs/websocket-webrtc-architecture.md), which is the
place to read it and the place to change it. Gotchas 1–3 below restate the three rules a change
is most likely to break; they are numbered because the Go source cites them by number
(`engine.go` cites gotcha 3 twice), so they are not free to renumber.

Two things that live nowhere else:

**Per-peer latency estimate** (`internal/engine`, from pion's stats in the same polling loop):

`latency ≈ RTT/2 + max(jitter × 2, 20 ms) + 20 ms`

where the last term is capture frame + codec + playback FIFO. Shown in the participant list as
`~Xms`: dim up to 80 ms, yellow to 150, red beyond.

**Remote mute** comes from the `mute-state` broadcast, sent on join, on toggle and whenever the
participant list changes, so a peer's state is known before they speak.

## The retired Node client, and where it is now

The Node/Ink client OpenMeet shipped until September 2026, on npm as `openmeet-terminal`. It
left the tree on 12 Sept 2026 — it was describing an application that no longer exists, in the
directory where one greps to learn how the one that does exist works.

Git keeps all of it at `terminal-v0.5.2`, a tag that cannot move, and no checkout is needed:

```bash
git show terminal-v0.5.2:packages/terminal/src/lib/audio/channels.ts
git grep -n "nvidia broadcast" terminal-v0.5.2 -- packages/terminal/src
git ls-tree -r --name-only terminal-v0.5.2 -- packages/terminal/src
```

Two backlog items still owe it code and cite those commands: Mic Channels (`channels.ts`) and
the RTX hint (`nvidia-broadcast.ts`). Everything else it had — the voice gate, the polyphase
resampler, the palette, the NVIDIA Broadcast matching — is already ported. The interface it
defined survives as the golden frames in `packages/go/internal/tui/testdata`, which are
self-contained files: no Go test reads the Node source, and never did.

npm still serves its README, with the retirement notice, from the published 0.5.2 tarball.

## CI/CD

### Workflow: `go-client.yml`

On pushes and PRs touching `packages/go/**`, on a macOS runner (the only host that can link CoreAudio; Windows is a zig cross-build from there): `go vet`, `go test ./...`, `build.sh`, `build-windows.sh`, then `openmeet-darwin-arm64`, `openmeet-windows-amd64.exe`, the installers, the Windows Terminal scripts and `SHA256SUMS` as an artifact — and on a `v*` tag, after checking the tag equals `v$(cat packages/go/VERSION)`, a GitHub Release with generated notes (`softprops/action-gh-release`). The client's updater and the installers read `releases/latest`.

### Workflows: `lint.yml`, `server.yml`, `website.yml`

One per unit, each triggered only by the paths that can affect it — a change to the Go client or
to documentation spends no runner on any of them. `lint.yml` runs Biome and installs the root
project alone, because Biome reads source rather than types. Its paths cover both packages and
the files that pin Biome itself, since `biome check .` walks everything `biome.json` includes
rather than one package. `server.yml` builds the server, which is how it is type-checked.
`website.yml` builds the site on pull requests only, since a push to `main` goes to
`deploy-website.yml`, which runs the same shared action before publishing.

What a change costs:

| Change | Workflows |
|---|---|
| `packages/go/**` | `go-client.yml` |
| the room's drawing (`internal/tui`, `internal/demo`) | `go-client.yml`, which fails until the exported terminal is regenerated — and then `deploy-website.yml` too, because regenerating it writes into `packages/website` |
| `packages/server/**` | `server.yml`, `lint.yml` |
| `packages/website/**` | `lint.yml`, then `website.yml` on a PR or `deploy-website.yml` on `main` |
| `packages/go/VERSION` | `go-client.yml`, and `deploy-website.yml` — the page prints the version |
| `Dockerfile` | `server.yml`, which builds the image |
| the root manifests or the lockfile | all three Node workflows |
| docs, `*.md` | none |

Note that **GitHub Actions does not resolve YAML anchors**, so each workflow writes its path
list out in full.

### How to publish a new version

```bash
echo 0.6.1 > packages/go/VERSION
$EDITOR CHANGELOG.md                     # [Unreleased] becomes [0.6.1] - <date>, + the compare link
git commit -am "chore(go): release 0.6.1"
git tag v0.6.1
git push && git push --tags              # go-client.yml builds both binaries and cuts the release
```

Then copy that version's section into the release body — the exact command is in
`CONTRIBUTING.md` under "Releases", which is the one copy of it.

**A release is not finished until `CHANGELOG.md` has its section and the GitHub release carries
a copy of it.** The workflow leaves the release body empty on purpose — GitHub's generated notes
list merged pull requests and this repository commits straight to `main`, so they arrive with
nothing in them.

`CHANGELOG.md` at the repository root is the record, in [Keep a Changelog
1.1.0](https://keepachangelog.com/en/1.1.0/) form against SemVer: an `[Unreleased]` section that
grows as work lands, the six headings (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`), ISO dates, compare links at the bottom, and an entry for **every** version — 0.6.1
shipped no changes and says so. Entries are prose written for someone using the app, symptom
first where a bug is involved, never commit subjects; the material comes from the commit bodies,
which already carry the symptom, the measurement and the reason. Because the client updates
itself, anything touching a flag, a `settings.json` key or the signaling protocol must be called
out explicitly with what to do about it. The full rules are in `CONTRIBUTING.md` under
"Releases".

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
| `pnpm dev` | Start the server (3001) in watch mode |
| `packages/go/scripts/build.sh && packages/go/openmeet --server ws://localhost:3001/ws` | Build and run the client against the local server |
| `pnpm build` | Build the server |
| `cd packages/go && go test ./...` | The client's tests, golden frames included |
| `packages/go/scripts/build-windows.sh` | Cross-build the Windows exe |
| `packages/go/openmeet --list-devices` | Validate a machine's audio stack without joining a room |
| `pnpm lint` | `biome check .` |
| `pnpm lint:fix` | `biome check --write .` |
| `pnpm format` | `biome format --write .` |

## Docker

- **Multi-stage build**: `node:22-alpine`, `pnpm install --filter @openmeet/server` then one `tsc` — no build order to respect since the protocol types moved into the server
- **pnpm prune**: Must use `CI=true pnpm prune --prod` (non-TTY environment)
- **Production**: Single container serves the REST API + WebSocket signaling on port 3001

## Known Gotchas

Things that cost a day to learn. Everything here applies to the client we ship unless it
says otherwise; what was specific to the retired Node client went with it.

### The room and the connection

1. **Three transceivers, same order, both sides — and then the data channel**: audio (0),
   webcam (1), screen (2), created before the offer and bound before the answer, then the
   `control` channel, which is what puts `application` at m-line 3. Do not reorder or skip:
   the m-lines are matched by position. Only the **offering** side creates the channel — an
   answer's m-lines mirror the offer's, so one created there is never negotiated — and a peer
   whose binary predates it offers no such section, which costs the room its files and
   nothing else.
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
28. **Asking the terminal for the mouse is the same switch as taking its selection away.**
    There is no mode where both work. Every terminal offers one modifier that hands a single
    drag back — Shift in Ghostty, Windows Terminal, WezTerm, kitty and VS Code, **Option** in
    iTerm2, **Fn** in Terminal.app — so a mouse that is on has to say which key that is, and
    must never ask for Shift itself (XTSHIFTESCAPE), which would take away the only way out.
    Ours is a setting because the trade is the user's. What replaces the terminal's selection
    has to be worth it: a selection in text rather than in cells, which cannot pick up the
    frame and does not cut a wrapped message into rows.
29. **`Cmd+C` reaches a terminal application only through the kitty keyboard protocol.** A
    chord with Super in it has no legacy encoding, so pressing it sends *nothing* — measured,
    not assumed. Turning the protocol on is not free: with its lowest flag, `Esc` becomes
    `CSI 27 u` and `Ctrl+key` becomes `CSI <code>;5u`, which are most of this keyboard, so
    `internal/keyboard` translates them back. Enter, Tab and the arrows are untouched, and a
    terminal that never answers the query never sends a CSI u sequence, so nothing changes
    there at all.
30. **A paste is one key event carrying the whole clipboard, newlines and all** — that is what
    bracketed paste is for, and Bubble Tea hands it over as a single `KeyRunes` with `Paste`
    set. Nothing splits it for you. And a control character that reaches a cell is written
    into the frame as itself: one newline in a row shifts every row after it and the screen is
    unreadable until the app restarts. So text is cleaned where it enters *and* the canvas
    refuses one on the way in (`Clean`, `Canvas.Set`). The second half is not belt and braces:
    a chat message from another client is data too. The same rule decides what counts as
    *typing*: Windows sends a rune event holding a NUL for the Ctrl key itself ahead of every
    ctrl chord, and taking that for text deleted the selection that the chord — usually the
    copy — was about to act on. `typed()` answers no to a key with nothing printable in it.

40. **A cell that paints its own background must carry its own foreground.** (Numbered out
    of order because the list above is cited by number and cannot be renumbered.) The
    transparent background is SGR 39/49 — the terminal's own colours — so `ThemeText` is not
    a colour there and anything that pairs it with a background of ours is a guess about a
    terminal we cannot see. Chips, meters and the selection band use `ThemeOnSurface` and
    `ThemeSelectionText` instead. The palette is package state written only by `SetTheme`,
    from the goroutine that draws; a test that changes it puts it back.

### Building and releasing

31. **pkg-config paths must be absolute.** A relative `PKG_CONFIG_PATH` resolves from the
    package directory and quietly falls back to Homebrew's dynamic libopus; `otool -L` on the
    binary is the check.
32. **`go get golang.org/x/sys@latest` bumps `go.mod` to a Go version we do not target.**
    Pinned to v0.41.0; `THREAD_PRIORITY_TIME_CRITICAL` is our own constant.
33. **The vendored miniaudio carries one patch of ours**, eight lines marked
    `/* OpenMeet patch */` and written down in `internal/audio/miniaudio/PATCHES.md`. Re-apply
    it on any upgrade, or Windows silently loses its voice processing.
34. **A release is the tag and `packages/go/VERSION` agreeing.** The binary reports VERSION
    and the updater compares it with the tag it downloaded, so a mismatch would loop; CI
    refuses the tag instead.
35. **`pnpm prune` in Docker needs `CI=true`** for a non-interactive environment.

### Files

36. **A paste can never carry an image to a terminal application.** Cmd+V is the terminal
    turning the clipboard into *text*, and a clipboard holding a PNG has no text to give, so
    the image cannot arrive through the keyboard at all. Reading it is ours, out of band —
    `osascript` on macOS, PowerShell over `-EncodedCommand` on Windows — under a key of its
    own, because the terminal eats Cmd+V (and Ctrl+V on Windows Terminal) before we see it.
    None of it works over SSH: the tool would run on the wrong machine and OSC 52 is
    write-only in practice. `clip.Remote()` already knows which case it is in.
37. **A file offer arrives before the connection it will be fetched over exists.** The
    announcement goes over the WebSocket, which is fast; the peer connection is still
    gathering candidates. So anything that asks a peer for something waits for the connection
    *and* the channel (`rtc.control`), rather than failing on a nil conn — failing there made
    a file look broken when it was only early.
38. **The name on an arriving file was chosen by somebody the room never authenticated.**
    Never build a path from it: take the basename, sanitise it, generate the destination, and
    check the result is still inside the download folder. Write to `.part`, verify the size
    and the digest, and only then rename, so a failed transfer leaves nothing that looks
    complete. Accepting is always a keypress; `--accept-files` is the one exception and it
    has to be asked for.
39. **A dropped file is typed in, one key at a time.** A terminal that accepts a drop writes
    the file's *path* into the application as ordinary key events — not a paste, so nothing
    frames it, and Windows Terminal does not deliver it in one piece. Two consequences, both
    of which shipped broken. Watching a single insert misses it: what has to be watched is
    what the **draft has become** (`refreshDraftFile`), which catches every delivery shape.
    And if the composer does not have focus, those keys are *commands* — a Windows path run
    through this room's keymap starts a screen share, mutes, and opens the device picker,
    which is exactly what one drop did. So the characters a path can begin with (`"`, `'`,
    `/`, `~`, `\`, `:`, or a capital) move the focus to the composer instead of falling
    through to the controls. The hole that is left is a drop while a *modal* is up, where the
    keys are the modal's; it can open a file window, and nothing worse.
