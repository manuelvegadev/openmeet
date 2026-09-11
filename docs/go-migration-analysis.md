# Should OpenMeet leave Node.js? — Research and verdict

Status: **decided, 11 September 2026** — the Node client gets two cheap corrections and then
the client moves to Go + pion. The analysis below is from the first round; the section
[What the measurements added](#what-the-measurements-added-11-september-2026) is what settled
it, and it changed the argument: the reason to leave is not performance in general, it is one
specific thing `@roamhq/wrtc` cannot do.

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

## What the measurements added (11 September 2026)

The first round of this document argued from distribution, platform reach and the state of
the binding. Then the CPU was actually measured (`docs/performance.md`), and the argument
changed shape. Three findings matter here.

**The codec is not the cost, and neither is JavaScript.** libopus encoding stereo at
128 kbps costs 0.66% of a core; the whole 10 ms JS frame pipeline costs 1.3%. What costs is
a libwebrtc PeerConnection carrying audio: ~7% of a core, of which the encoder is a third,
the rest being SRTP, the paced sender, the send controller and a fake audio device module
that pulls playout every 10 ms per connection. A rewrite that only changed the language would
move the 1.3% and leave the rest.

**Node cannot encode once.** This is the finding that decides the runtime. `RTCAudioSource`
accepts PCM, and `@roamhq/wrtc` exposes no encoded path at all — no insertable streams, no
encoded transform, no access to RTP. Every PeerConnection therefore builds its own Opus
encoder, and a mesh of six is five encoders for one microphone. It is not an inefficiency to
optimise; it is the shape of the API.

pion is the opposite shape. One `TrackLocalStaticRTP` is added to every PeerConnection and
`WriteRTP` writes the same packet to all of them, adjusting SSRC and payload type per
binding. **Encode once, fan out N** — which is Mumble's efficiency, with no media server, no
loss of end-to-end encryption, and the mesh intact. The per-peer cost that remains is SRTP
and a `sendto`: microseconds at 64 kbps. That is the whole argument for Go in one sentence,
and it is about the library rather than the language.

**The UI was the other half, and it did not need a migration.** React was running its
development build in every install, and a VU meter refreshed at 10 Hz was forcing ~8.5
full-screen repaints a second. Both are fixed in Node (gotchas 36–38): a silent room of four
went from ~20% of a core per client to ~7%. What that means for this document is that **the
corrections are not a delaying tactic and not wasted work** — they are design decisions
(paint on change, do not transmit silence) that the Go client inherits. The code is thrown
away; the design is not.

### Constraints the migration inherits

Not negotiable, in this order:

1. **Resource consumption is the point.** The target is Mumble's, not Discord's: an audio
   call for 1–3% of a core, flat with room size, and tens of MB resident.
2. **Audio quality second**, and it is the part with real engineering risk (see the playout
   note below).
3. **Screen and camera third**, and they **stay on WebRTC** — pion's congestion control and
   the automatic quality adaptation are worth the machinery for video, which is bursty and
   compresses badly at a fixed rate. Audio does not need any of it.
4. **Audio is client-to-client and never passes through a server.** No media server, no
   relay we operate, nothing for anyone to listen to. This is a privacy property, not a
   performance one, and it is why an SFU was rejected even though it would also solve the
   encoder problem.
5. **One binary, three platforms.**

### The one hard part, named

Pion does no playout. libwebrtc gives us NetEq for free today: an adaptive jitter buffer,
packet-loss concealment, and time-stretching to absorb the drift between two sound cards that
disagree about what 48 kHz means. Opus's in-band FEC and PLC cover the loss; the adaptive
buffering and the drift are ours to write. Mumble uses the speex jitter buffer (BSD) for
exactly this, which is the reference worth reading before inventing anything. Everything else
in the migration is mechanical work; this is the part that decides whether the calls sound
good.

### Device problems the Go client has to answer for

From testing with real people on their own machines, September 2026. These are not
migration-blockers so much as the requirements the device layer is actually judged on — and
all three are in the layer the migration replaces (`malgo`/miniaudio instead of
audify + per-OS enumeration), so they are worth fixing there rather than twice.

1. **macOS, Elgato Wave / Wave Link: we appear to capture the microphone *before* its
   effects.** Wave Link presents processed audio as its own virtual devices (`Wave Link
   Stream`, `Wave Link MicrophoneFX`); selecting the hardware Elgato input gets the raw
   signal, which is the one without noise suppression or EQ. Needs confirming device by
   device, then either preferring the processed endpoint or saying plainly in the picker
   which one carries the effects. Related: `audio/nvidia-broadcast.ts` already does exactly
   this reasoning for the Windows equivalent, so the shape of the answer exists.
2. **macOS, AirPods: listening to peers degrades.** Almost certainly Bluetooth rather than
   AirPods: when a Bluetooth output is also opened as an *input*, macOS switches the device
   to the hands-free profile (HFP/SCO), which is mono at 8–16 kHz, and everything sounds like
   a telephone. The fix is to never open a Bluetooth input while a Bluetooth output is in
   use, and to say so in the picker. Verify with `scripts/audio-matrix.ts` on an AirPods pair
   — it reports each device's native rate, which is where the profile switch will show.
3. **Windows: devices appear and disappear as they are connected, and NVIDIA Broadcast is
   intermittent.** There are no default-device-change notifications from RtAudio (gotcha
   21e), the device list is enumerated once, and a Bluetooth headset connecting after the
   picker opened is simply not there. A native client should watch for device changes
   (`IMMNotificationClient` on WASAPI, `kAudioHardwarePropertyDevices` on CoreAudio) and
   re-enumerate, rather than snapshotting at startup. The Broadcast flakiness is probably the
   same thing seen from the other side: the virtual device exists only while the app runs,
   and `resolveBroadcastDefault` only names it when it is the *system* default at the moment
   we looked.

## Spike results (11 September 2026, branch `go-migration`, `packages/go`)

Audio only, against the real server and real Node clients in the same room, on this Mac.
Go 1.25, pion 4.2.20, libopus 1.6 via cgo, miniaudio via malgo, Bubble Tea v1.

| | Go client, one process with its TUI | Node engine, without its TUI |
|---|---|---|
| 1 peer, both directions | 7.8% of a core, 31 MB | 7.3%, 125 MB |
| **3 peers, sending to all three** | **7.6–8.0%, 33 MB** | 11.4–12.3%, 130 MB |
| receive only | 3.9–4.1%, 31 MB | 6.2% |
| terminal output while idle | 139 B/s | 90–100 KB/s |

The three questions the spike was to answer:

1. **Does encoding once keep CPU flat with room size?** Yes: two more peers cost the Go
   client nothing measurable; the Node engine sending to three rose by two thirds.
2. **Does the playout sound right?** Audio flows both ways through the Node client's
   own meters and the gate opens on it, so the decode and the mix are correct. Whether it
   *sounds* right on a lossy link needs ears and a real network; the buffer converges to
   ~80 ms and trims bursts by dropping a packet, which is audible and is the first thing to
   replace (time-stretching).
3. **Does the cgo build hurt?** Not on macOS: `brew install opus` and `go build`. Windows and
   Linux are not yet built.

Second round, the same afternoon, after asking *why* the numbers were not lower:

| Go client, one process | before | after |
|---|---|---|
| devices open, nobody in the room | 1.9% | **1.0%** |
| receiving one continuous stream | 3.9% | **2.2%** |
| both directions, continuous (complexity 10 / 5) | 7.8% | **5.5% / 4.4%** |

What changed, and what each was worth:

1. **The audio callback is not in Go at all any more.** The same two devices cost 0.3% in a
   C process and 1.9% with malgo's Go callbacks — entering the runtime from a foreign thread
   two hundred times a second. `internal/audio/shim.c` compiles miniaudio in and keeps the
   callbacks in C, moving samples to and from lock-free rings; a Go goroutine pumps the rings
   with plain cgo calls. malgo is gone.
2. **One wake per 20 ms, not four per 10.** The profile of a client doing nothing but pumping
   was mostly `findRunnable` → `kevent` → `pthread_cond_signal`: the Go scheduler waking a
   thread costs ~100 µs on macOS, and there were a ticker, a capture hand-off goroutine and
   the callbacks all waking things. Now there is the pump, and the encoder runs on it.
3. **pion without NACK and TWCC** for audio (in-band FEC does the job): 1.2% → 0.9% on the
   receive path alone.
4. **Opus complexity** is a real lever: 10 → 5 saves 1.1 points in the duplex case. Left at
   10 by default until someone listens to the difference at 64 kbps.

What remains, in order: the UDP `sendto` (a quarter of the duplex profile — on macOS
loopback the sender also does the receiver's delivery, so this is partly an artefact of
measuring on one machine), the codec, and the one wake per pump. That last one is the price
of Go; a native client's CoreAudio thread does the work in place and pays nothing for it.

**What this means for the Discord comparison.** Discord's client is native: its audio
callback works in place, its packet path is C++, it has one connection, and it sends
nothing while you are silent. Of those, the Go client now has the last two, and pays about
one point of a core for not having the first two. In a real two-person call — real network,
people talking in turns — that puts it at one to two percent on this Mac, with 31 MB
resident. The Node client cannot get there from where it is: its engine alone is 6–8% in
the same states, before its TUI.

**Windows, the same day.** `scripts/build-windows.sh` cross-builds a static PE from the Mac
(zig as the C toolchain, libopus built once for `x86_64-windows-gnu`, miniaudio in the tree;
12.7 MB, system DLLs only). On the rig — Windows 11, i7-9700K — joined a room against a Node
client on the Mac over the LAN, both directions: **1.25% of one core and 25.9 MB** while
sending continuously and decoding a continuous stream. The macOS numbers above carry the
loopback and thread-wake costs this run does not, which is the better guide to a real call.
