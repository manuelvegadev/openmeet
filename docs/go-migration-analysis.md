# Should OpenMeet leave Node.js? — Research and verdict

Status: analysis, September 2026. Branch `analysis/go-migration`. No decision taken yet.

## The question

OpenMeet is now terminal-only: a TUI for P2P WebRTC calls with stereo Opus audio, webcam and screen share, and chat. The stated goals are:

1. Simple install and distribution, ideally one binary.
2. Cross-platform: macOS, Linux, Windows.
3. Works on an average machine with whatever audio/video devices it has.

The question is not "how many lines to rewrite" but **which runtime can actually deliver those three goals**, and whether choosing Node.js was a mistake.

## Where the current stack stands today

Facts from the repo and from upstream:

- **Platforms**: macOS and Linux only. Linux assumes X11 (`x11grab`, `xrandr`) and PulseAudio (`pactl`). No Wayland/PipeWire, no Windows backend at all in `devices.ts`/`video.ts`.
- **Audio path**: sox child process → 10 ms PCM frames pushed through the JS event loop → `RTCAudioSource`. `audio.ts` already contains two guards against event-loop stalls corrupting capture and playback buffers. No echo cancellation, noise suppression or AGC anywhere.
- **Video path**: ffmpeg → raw I420 → JS scaler/overlay → `RTCVideoSource`; receive is `RTCVideoSink` → JS → ffplay. Documented ceiling of 1080p30 because ~330 MB/s of raw frames overwhelms the event loop.
- **`@roamhq/wrtc`** (the only Node binding that includes codecs, jitter buffering and a media engine):
  - One active maintainer, funded by Roam for their server-side use case. Latest 0.10.0 (Mar 2026). Bundles **libwebrtc M106 from Oct 2022**; a newer libwebrtc has been "wip" on `develop` since March with nothing released.
  - Open bugs directly relevant to us: `RTCAudioSink::OnData` `new[]`/`delete` mismatch (heap corruption class, #52, unanswered); `RTCAudioSource` audio reaching only one peer in mesh calls (#23); no stereo source (#47, we work around it); no timestamps on `onData`/`onFrame` so A/V drifts on long calls (node-webrtc #503 since 2019); 10 ms frame size is wontfix.
  - Prebuilds: darwin arm64/x64, linux x64/arm64, win32 x64. No Windows ARM, no Alpine/musl.
- **Single-binary distribution is not achievable**: Node SEA needs the `.node` addon extracted to a temp file at runtime and produces ~50 MB+ executables; `pkg` is deprecated with an unpatched CVE; **Bun segfaults on `require('@roamhq/wrtc')`**; the Windows addon delay-loads from `NODE.EXE` and breaks inside any renamed executable (#39). Users must also install sox and ffmpeg themselves.
- **Windows on this stack** would need Node 22, `npm -g`, ffmpeg via winget, a 2015-vintage sox build placed on PATH, Windows Terminal, and a third capture backend (`dshow`) we have not written. That is hobbyist territory.
- **Ink**: we are on v5, two majors behind v7. Ink re-lays-out the whole Yoga tree and re-renders the full frame on every state change; cell-level diffing is opt-in and has had its own flicker bugs. Bubble Tea v2 and ratatui diff at cell level natively. Our `\x1b[3J` patch is Ink issue #800.
- **Existence proof**: no shipped Node CLI/TUI voice or video client exists other than OpenMeet. Every Node user of `wrtc` treats it as transport and pipes media from external processes, which is exactly our architecture and inherits its drift/no-AEC/10 ms-framing problems.

Sources: [node-webrtc fork](https://github.com/WonderInventions/node-webrtc), [issues](https://github.com/WonderInventions/node-webrtc/issues), [node-webrtc #503](https://github.com/node-webrtc/node-webrtc/issues/503), [Node SEA](https://nodejs.org/api/single-executable-applications.html), [Bun #24609](https://github.com/oven-sh/bun/issues/24609), [Ink releases](https://github.com/vadimdemedes/ink/releases), [Ink flicker analysis](https://github.com/atxtechbro/test-ink-flickering/blob/main/INK-ANALYSIS.md).

**Was Node a bad decision?** For getting a working prototype on macOS/Linux quickly, with libwebrtc doing the codec, jitter and encoding work for free: no, it was a sensible shortcut. For the three stated goals: it has a hard ceiling. The binding is a stale one-person fork with memory-safety bugs, the media path runs through a garbage-collected event loop, single-binary packaging is blocked, and Windows is effectively out of reach. None of that improves with more features; it gets more expensive to leave.

## What the alternatives actually offer

### Go (pion)

- **pion/webrtc v4** is mature and very active (v4.2.19, Aug 2026; ~16.7k stars). Transport, ICE/DTLS/SRTP, transceivers, renegotiation, TWCC/NACK/FlexFEC, GCC send-side bandwidth estimation via `pion/interceptor`.
- **Same workarounds as today**: pion does **not** support SDP rollback (#2416 open since 2023), so glare stays close-and-recreate. There is a known "direction change + ReplaceTrack → OnTrack not fired" issue (#2374), the same class we patch with `onunmute`.
- **Pion does no decoding or audio playout.** Its jitter buffer is a packet-reordering interceptor, not a NetEQ-style audio playout buffer with packet-loss concealment. We would write Opus decode → per-peer ring buffer → playout timing → mixing ourselves. `@roamhq/wrtc` does this for us today.
- **Audio device I/O is the real win**: `gen2brain/malgo` (miniaudio) gives capture, playback and device enumeration in-process on CoreAudio, WASAPI, ALSA, PulseAudio, JACK with no external libraries (cgo, header-only). This removes sox and gives us the device callback, which is the only place clock drift and latency can be controlled.
- **Opus**: `hraban/opus` (cgo, libopus) is the proven encoder. Pure-Go options are emerging (`pion/opus` encoder is CELT-only but supports 48 kHz stereo, which is exactly our 256 kbps profile; `gopus` claims bit-exact parity but is months old). Viable as an experiment with a cgo fallback.
- **Video**: `pion/mediadevices` exists (v0.10.0, Apr 2026) with camera drivers for v4l2, AVFoundation and DirectShow, but its macOS screen capture uses the CGDisplay API Apple obsoleted in macOS 15 (#599, #582 open) and its Windows drivers are old DirectShow. There is **no production pure-Go VP8 decoder**. Realistically ffmpeg stays for webcam/screen capture on macOS/Windows and ffplay stays for display, i.e. the same shape as today, but the raw-frame scaling moves out of a GC'd event loop into goroutines with reused buffers.
- **Cross-compilation**: Linux and Windows build from one Linux host with `zig cc`; macOS must build on a macOS runner because malgo links CoreAudio frameworks and Apple's SDK cannot be redistributed. GitHub Actions with one macOS job and one Ubuntu job covers all five targets. That is a real build matrix, but it ends in downloadable binaries and a Homebrew tap, which Node cannot reach.
- **Existence proof: weak.** Every Go voice client found (barnard, gavv/webrtc-cli, dialup ascii, discordo's voice PR) was Linux-first, cgo-bound to OpenAL/Pulse/PortAudio, and is dead or unmerged. The best-distributed Go WebRTC CLI, LiveKit's `lk`, deliberately does not capture devices and takes IVF/Ogg from ffmpeg.

Sources: [pion/webrtc](https://github.com/pion/webrtc), [#2416](https://github.com/pion/webrtc/issues/2416), [#2374](https://github.com/pion/webrtc/issues/2374), [interceptor gcc](https://pkg.go.dev/github.com/pion/interceptor/pkg/gcc), [jitterbuffer](https://pkg.go.dev/github.com/pion/interceptor/pkg/jitterbuffer), [mediadevices](https://github.com/pion/mediadevices), [mediadevices #599](https://github.com/pion/mediadevices/issues/599), [malgo](https://github.com/gen2brain/malgo), [hraban/opus](https://github.com/hraban/opus), [pion/opus](https://github.com/pion/opus), [cgo cross-compiling](https://johncodes.com/archive/2026/02-11-cross-compiling-cgo/), [livekit-cli](https://github.com/livekit/livekit-cli), [barnard](https://github.com/layeh/barnard), [webrtc-cli](https://github.com/gavv/webrtc-cli).

### Rust

- **Existence proof: strong.** `concord` (Discord TUI, created May 2026, ~1.3k stars, active) does voice with noise suppression, mic selection, screen share broadcast and viewing on Linux, macOS 13+ and Windows, and ships via `cargo`, `brew`, `npm -g`, Nix and prebuilt binaries. Stack: `cpal` for audio, `opusic-c` (bundled libopus, no system dep), native per-OS screen capture (PipeWire portal, Windows Graphics Capture, ScreenCaptureKit), hardware encoders with software fallback, `mpv` for remote video. Its tracker still shows "robotic microphone" and clock-drift bugs: even a good stack does not make audio easy.
- **Device libraries are the best of the three ecosystems**: `cpal` 0.18 (19M downloads, CoreAudio/WASAPI/ALSA/PipeWire/JACK), `screencapturekit` crate actively maintained, `nokhwa` for cameras (aging, macOS issues), `xcap` for screenshots.
- **WebRTC is the risk.** `webrtc-rs` is mid-rearchitecture: v0.17 was the "final feature release" of the old design, production users are told to pin it, and the new sans-I/O line went 0.21.0-rc.1 on Aug 31, 2026 with 1.0 gating items closed only weeks ago. Historically weaker bandwidth estimation than pion. `str0m` is excellent but sans-I/O and SFU-oriented; you write the PeerConnection glue yourself.
- **The only maintained way to get libwebrtc's real media engine (AEC, NetEQ, BWE) in a native binary** is LiveKit's `libwebrtc` Rust crate: it exposes `NativeAudioSource`/`NativeVideoSource` exactly like node-webrtc's nonstandard API, but pulls 110–265 MB prebuilt archives per platform at build time and is 11% documented.
- **Velocity**: slower compiles, async/`Pin`/`Send` friction in exactly the callback-heavy media pipeline we need, and a steeper curve for a TypeScript-native developer.

Sources: [concord](https://github.com/chojs23/concord), [cpal](https://github.com/RustAudio/cpal), [webrtc-rs feature freeze](https://webrtc.rs/blog/2026/01/31/webrtc-v0.17.0-feature-freeze-sansio-shift.html), [webrtc-rs 1.0 tracking](https://github.com/webrtc-rs/webrtc/issues/836), [str0m](https://github.com/algesten/str0m), [livekit libwebrtc crate](https://docs.rs/libwebrtc/latest/libwebrtc/), [prebuilt sizes](https://github.com/livekit/rust-sdks/releases/tag/webrtc-89d790b).

### What every working cross-platform project has in common

Looking at the ones that run on all three desktop OSes (concord, baresip, endcord, partly Toxic):

1. They own the audio device callback in-process (cpal, PortAudio, per-OS driver modules), never a PCM pipe from a child process. Drift, echo and latency are only controllable there.
2. They bundle libopus statically and write **per-OS native capture** for camera and screen. No single cross-platform capture library survives unmodified; Linux screen capture (X11 vs Wayland/PipeWire) is the perennial bug source in every one of them.
3. They ship prebuilt binaries plus a package-manager path.

The hard problems (echo cancellation, playout jitter buffer, bandwidth adaptation, device quirks) are language-independent. The only way to not write them is to embed libwebrtc, which is what we do today through a stale fork.

## Comparison against the three goals

| Goal | Node (today) | Go + pion | Rust |
|---|---|---|---|
| One-binary install | Blocked (addon extraction, Bun crash, Windows delayload); users install Node + sox + ffmpeg | Yes for Linux/Windows from one host; macOS built on a macOS runner. sox gone. ffmpeg still needed for video. | Same as Go; strongest installer story in practice (concord ships brew/npm/binaries) |
| macOS / Linux / Windows | macOS + Linux/X11 only; Windows impractical | All three for audio via malgo. Video on macOS/Windows via ffmpeg. Wayland via portal work. | All three, with the best native capture crates |
| Adapts to average machines and devices | sox device selection by name, no AEC, event-loop stalls degrade audio | In-process device enumeration and callbacks; still no AEC unless we add one (e.g. speex/WebRTC APM via cgo) | Same as Go, plus more mature capture/encoder crates and a proven reference app |
| WebRTC library risk | One-person fork, libwebrtc from 2022, open memory bugs | Low: pion v4 stable and active | Medium-high: webrtc-rs rewrite at RC stage |
| Developer velocity for this team | Highest today | High: simple concurrency, fast builds, close to TS ergonomics | Lowest |
| Existence proof for this exact app shape | None | None (Go voice TUIs are Linux-only and dead) | concord (2026) |

## Verdict

**Staying on Node is not favorable for the stated goals.** The stack can keep serving macOS and Linux users who are willing to install Node, sox and ffmpeg, but it cannot produce a single binary, cannot reach Windows without a large amount of new platform code on top of a fragile base, and depends on a binding whose maintenance and memory safety we cannot plan around. Each new feature built on it raises the cost of leaving.

**The moment to migrate is now, not later.** The web client was just removed, the protocol is stable and small, and the terminal is ~5.3k lines with a clear module split. The signaling protocol does not change, so a new client can interoperate with the current one during the transition and the server can stay as it is until the end.

**Go is the recommended target**, with Rust as the explicitly considered alternative:

- Go's WebRTC layer is the safest non-libwebrtc option available today, and the language matches the team's velocity. Its weak points (ffmpeg still needed for video capture/decode, no AEC out of the box, cgo build matrix) are exactly the same weak points Rust has, minus Rust's WebRTC churn.
- Rust would be the pick only if device/capture ecosystem maturity and concord's precedent outweigh the cost of webrtc-rs being mid-rewrite and a slower development pace. If, later, the app needs libwebrtc-grade audio processing (AEC, NetEQ), LiveKit's Rust crate is the only maintained door to it, and that would be the moment to reconsider.

**What Go does not fix, stated plainly**: echo cancellation, an audio playout buffer with loss concealment, bitrate adaptation for ffmpeg-encoded video, and per-compositor screen capture on Linux all become our code. We accept that in exchange for owning the device path and the binary.

## Proposed path

1. **Spike (3–4 days)**: Go + pion + Bubble Tea v2 + malgo + hraban/opus, audio only. Join a real room against the current Node terminal through the existing server (3-transceiver contract, glare, renegotiation). Measure end-to-end audio latency against the current `~Xms` estimate, and CPU with a 1080p IVF stream from ffmpeg flowing through pion. Build darwin/arm64 natively and linux/amd64 + windows/amd64 with `zig cc`. Go/no-go on latency parity and build pain.
2. **Phase 1, audio client at parity**: devices, settings, chat, participant list, stats, latency estimate, retries. Ship as GitHub Releases + Homebrew tap; keep `openmeet-terminal` on npm pointing users to the binary.
3. **Phase 2, video**: ffmpeg → IVF → pion for webcam and screen; RTP → IVF → ffplay for receive; scaler/overlay ported to Go. Keep the current ffmpeg device enumeration. Add `dshow`/`gdigrab` for Windows and a PipeWire portal path for Wayland.
4. **Phase 3, server in Go** (1–2 days) to unify the repo, with a `FROM scratch` image.
5. **Later, if needed**: AEC via a cgo-wrapped WebRTC audio processing module or speexdsp; pure-Go Opus once `pion/opus`/`gopus` mature, to drop libopus from the build matrix.
