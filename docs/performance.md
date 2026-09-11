# A/V performance: baseline and results

Every millisecond the video path spends on the engine's event loop is a millisecond the
10 ms audio cadence can be late, and audify drops a capture frame it cannot deliver
(`NonBlockingCall`). So the metric that matters is not CPU percentage — it is **how often
the audio frame gap exceeds 30 ms**, which is an audible dropout.

## How to reproduce

```bash
pnpm --filter openmeet-terminal exec tsx scripts/av-bench.ts [seconds-per-phase] [screen-index]
```

`scripts/av-bench.ts` drives the real `VideoManager` on both sides of a loopback
PeerConnection — real ffmpeg capture, real VP8 encode and decode, real ffplay — while the
real audio frame pipeline (`InputConditioner` → `RTCAudioSource`, `RTCAudioSink` →
`PeerPlayoutBuffer` → `FrameMixer`) runs at 10 ms. Three phases isolate the two directions:

| phase | what runs |
|---|---|
| `idle` | audio only |
| `send` | + screen capture, frame assembly, VP8 encode |
| `send+recv` | + decode, rescale, letterbox, overlay, write to ffplay |

Receive cost is the difference between the last two.

**Windows**: screen capture needs the interactive desktop. Run it from the console session
(desktop shortcut, or `schtasks /create … /it` + `/run`) — never over SSH, where session 0
has no display and both gdigrab and ddagrab fail.

## Baseline — 2026-09-09, before any change

10 s per phase. `gap` is between consecutive audio frames (10 ms is perfect); `glitch`
counts gaps over 30 ms; `recv handler` is time spent inside the frame callback.

### Windows — i7-9700K, RTX 2080 SUPER, 1080p60, Node 24

| phase | gap p50 | gap p99 | gap max | loop p99 | recv p50 | recv max | node CPU | glitches |
|---|---|---|---|---|---|---|---|---|
| idle | 10.1 | 11.9 | 12.0 | 6.0 | — | — | 3.0% | **0** |
| send | 11.0 | 30.0 | 34.8 | 24.6 | — | — | 129.4% | **7** |
| send+recv | 12.8 | 31.4 | 50.7 | 27.3 | 6.5 | 9.4 | 160.4% | **11** |

### macOS — M4 Pro, 3096x1296, Node 26

| phase | gap p50 | gap p99 | gap max | loop p99 | recv p50 | recv max | node CPU | glitches |
|---|---|---|---|---|---|---|---|---|
| idle | 10.2 | 11.8 | 23.1 | 6.9 | — | — | 10.5% | 0 |
| send | 10.3 | 12.6 | 13.4 | 7.6 | — | — | 90.8% | 0 |
| send+recv | 10.4 | 15.3 | 20.5 | 10.5 | 2.6 | 4.2 | 104.2% | 0 |

### What the baseline says

- **Sharing a screen costs Windows 7 to 11 audible audio dropouts every 10 seconds.** The
  idle phase has none, so the audio pipeline itself is not the problem.
- **The receive handler costs 6.5 ms of a 10 ms budget on Windows** (2.6 ms on the M4 Pro).
  A single remote video stream nearly consumes the audio period on its own.
- Apple Silicon absorbs the same pipeline with zero dropouts, which is why the work is
  scoped to Windows first.

## After — 2026-09-09, same machines, same command

Changes in this round: screencast encoding mode, the frame assembler, the receive path with
no JS rescale, `ddagrab` with `dup_frames=false` on Windows, high process priority on
Windows, a 128 kbps Opus ceiling per direction, and RED preferred for audio.

### Windows — i7-9700K, RTX 2080 SUPER, 1080p60

| phase | gap p50 | gap p99 | gap max | loop p99 | recv p50 | recv max | node CPU | glitches |
|---|---|---|---|---|---|---|---|---|
| idle | 10.1 | 11.8 | 12.0 | 6.0 | — | — | 3.1% | 0 |
| send | 10.2 | 11.9 | 14.5 | 6.3 | — | — | 34.2% | **0** |
| send+recv | 10.2 | 11.8 | 12.6 | 7.0 | 0.6 | 3.6 | 62.8% | **0** |

With `OPENMEET_BENCH_NOISE=1` (RNNoise in the capture chain), still zero glitches:

| phase | gap p99 | loop p99 | node CPU | glitches |
|---|---|---|---|---|
| idle | 11.9 | 6.6 | 7.0% | 0 |
| send | 11.9 | 6.8 | 43.4% | 0 |
| send+recv | 11.9 | 7.1 | 78.9% | 0 |

### macOS — M4 Pro, 3096x1296

| phase | gap p50 | gap p99 | gap max | loop p99 | recv p50 | recv max | node CPU | glitches |
|---|---|---|---|---|---|---|---|---|
| idle | 10.2 | 11.8 | 23.1 | 6.9 | — | — | 10.5% | 0 |
| send | 10.4 | 12.1 | 12.7 | 7.0 | — | — | 41.4% | 0 |
| send+recv | 10.5 | 11.9 | 12.6 | 7.0 | 0.1 | 0.3 | 42.7% | 0 |

### Windows, before and after

| | before | after |
|---|---|---|
| audio glitches while sending | 7 per 10 s | **0** |
| audio glitches while sending and receiving | 11 per 10 s | **0** |
| audio gap p99 (send+recv) | 31.4 ms | 11.8 ms |
| audio gap max (send+recv) | 50.7 ms | 12.6 ms |
| event loop p99 (send+recv) | 27.3 ms | 7.0 ms |
| receive handler p50 | 6.5 ms | 0.6 ms |
| node CPU (send) | 129.4% | 34.2% |
| node CPU (send+recv) | 160.4% | 62.8% |

One regression to keep in view: displayed frames went from 300/300 to about 257/301,
because frames now reach ffplay at 1080p (3.1 MB) instead of a rescaled 720p (1.4 MB) and
the pipe cannot always keep up, so the backpressure guard drops some. The trade is roughly
25 fps at full resolution against 30 fps at 56% of the pixels, which for screen content —
where legibility is the point — is the better side. Worth revisiting if it is ever visible
on a webcam stream.

## Supporting microbenchmarks

Measured separately, on the M4 Pro unless noted:

| what | cost |
|---|---|
| `Buffer.concat` frame assembly (current) | 5.22 ms/frame, 2.31 GB/s memcpy |
| preallocated accumulator (proposed) | 0.03 ms/frame, 0.09 GB/s |
| `scaleI420` 1920x1080 → 1280x720 | 2.66 ms/frame, per remote stream |
| `InputConditioner` + `FrameMixer` (5 peers) | 0.004 ms per 10 ms frame |
| RNNoise, channels identical (any mono mic) | 0.224 ms per 10 ms frame |
| RNNoise, genuinely stereo input | 0.445 ms per 10 ms frame |

Capture paths, measured on the Windows box at 1080p with ffmpeg's own `-benchmark`:

| path | CPU |
|---|---|
| `gdigrab` + CPU scale (current) | 38% of one core |
| `gdigrab` + scale + x264 veryfast | 65% |
| `ddagrab` + CPU scale | 29% |
| `ddagrab`, no scale, `dup_frames=true` | 41% |
| `ddagrab`, no scale, **`dup_frames=false`** | **3%** |
| `ddagrab` → **`h264_nvenc`** from D3D11 | **1%** |
| `ddagrab` → `scale_d3d11` | fails: `Could not create the texture (80070057)` |
| `ddagrab` → `hwmap=derive_device=cuda` | fails: `-40` (ENOSYS) |
| `ddagrab` → `hwmap=derive_device=vulkan` + libplacebo | fails: `-40` (ENOSYS) |

GPU scaling is unavailable on this ffmpeg build by every route tested, so any path that
needs I420 in system memory pays the colour conversion on the CPU.

## Footprint, measured for the website (2026-09-10)

The numbers the landing page quotes come from one afternoon on this Mac — Apple M4 Pro,
24 GB, macOS 15.7.9, Node 26.7 — with a real two-person call: the signaling server on
localhost and two clients joined to the same room, audio flowing both ways at 259 kbps with
a ~40 ms estimated latency. `phys_footprint` (what Activity Monitor calls Memory), summed
across an app's processes.

| what | state | footprint |
|---|---|---|
| **engine** (`--engine` child) | two-person call, 35 minutes | **65–68 MB, flat** |
| TUI process | same call, first minutes | 180–260 MB |
| TUI process | same call, 20 minutes | ~620 MB |
| TUI process | same call, 35 minutes | 862 MB |
| TUI process | `--max-old-space-size=192` | 168–250 MB, same call, no complaints |
| Discord 0.0.411 | signed in, idle, **no call** | 649 MB over 7 processes |
| Google Meet in Chrome 152 | in a call, camera off | **+433 MB** on top of the running browser |

On disk: `npm install -g openmeet-terminal` costs **78 MB** (`@roamhq/wrtc` 24 MB, `audify`
19 MB, `es-toolkit` 18 MB); `Discord.app` is 479 MB and `Google Chrome.app` 1.4 GB.

**The TUI's heap is the finding here.** The engine never moves — 65 MB for the whole call,
which is the number that matters, since it is the process with the 10 ms deadline. The TUI
climbs: not a leak that ends in an OOM (it plateaus, and a capped heap runs the identical
call in a third of the space) but V8 growing into free RAM because ~10 renders a second of
VU meters produce garbage and nothing pushes back. On a 24 GB machine the result is a
terminal UI showing 862 MB in Activity Monitor after half an hour, which is not a good look
for a client that sells itself as light. Worth deciding before 1.0 whether the launcher
should cap the TUI's old space; the engine needs no such thing.

Because of that the website compares **install sizes**, which are unambiguous, and quotes
the engine's flat 65 MB — never a total-memory figure.

## Where an audio-only call spends its CPU — 2026-09-11

The measurements above are about video on the engine's loop. This round asks a plainer
question: **why does an audio-only call cost more than Discord does?** Everything here is
from this Mac — Apple M4 Pro, macOS 15.7.9, Node 26.7 — with the signaling server on
localhost. `scripts/audio-cost.ts` is the decomposition, `scripts/tui-cost.tsx` the renderer,
and real clients in a real room are the verdict.

### A real call, per client, before any of this

| | 2 people | 4 people |
|---|---|---|
| TUI process | 11–13%, 250–350 MB | ~10%, 330 MB |
| engine process | 4.6%, 130 MB | 8.2%, 120 MB |

The TUI also wrote **90–100 KB/s to the terminal, about 8.5 full-screen repaints a second**,
with nothing on screen moving but the VU meters. That cost is paid twice: once by us to
produce the frame, once by the terminal emulator to parse and paint it.

### The engine, decomposed (`scripts/audio-cost.ts`)

A loopback connection carries one encode and one decode, which is what one peer in the mesh
costs us. Each phase is 12 s; the process holds both ends, so the absolute numbers are about
twice what one client pays — the differences between rows are the finding.

| phase | CPU |
|---|---|
| the 10 ms frame pipeline in JS, no wrtc | **1.3%** |
| + `RTCAudioSource.onData` | 1.7% |
| + one connected PeerConnection, **no media** | 1.9% |
| + **sending one audio track** (nobody decoding) | **8.9%** |
| + decode and sink | 10.1% |
| the same, mono 32 kbps with DTX | 8.5% |
| three peers (a room of four) | 20.4% |
| **libopus itself**, stereo 128 kbps, 10 ms frames (ffmpeg `-benchmark`) | **0.66%** |
| libopus, mono 32 kbps, 20 ms frames | 0.29% |

Three conclusions, and none of them is the one that was assumed:

1. **The codec is not the cost.** Opus is under 1% of a core; the send path around it is ten
   times that. Bitrate and stereo barely move the number (10.1% against 8.5%).
2. **JavaScript is not the cost.** The whole conditioning-and-mixing pipeline at 100 frames a
   second is 1.3%.
3. **A PeerConnection is.** An idle one is free; the moment it carries our audio it is ~7% of
   a core, and in a mesh that multiplies by the number of peers.

`sample` on the send-only phase says where those 7% go: `opus_encode` ~2.4% of a core, and
the rest in libwebrtc's machinery — SRTP and `sendto` on the worker thread, the paced sender,
`rtp_send_controller`, and a **`TestAudioDeviceModuleImpl`** thread pulling playout every
10 ms (`AudioTransportImpl::NeedMorePlayData` → `AudioMixerImpl::Mix` → NetEq →
`opus_decode`) whether or not anything consumes the mix. That pull is also what feeds
`RTCAudioSink`, which is why a receiving connection costs even when the peer is silent.

### The TUI: React, and React in the wrong build

A full room render, measured into a fake 120x34 terminal (`scripts/tui-cost.tsx`), and a CPU
profile of the same loop:

| | share of busy time |
|---|---|
| React (`jsx-runtime`, `react`, `react-reconciler`) | ~56% |
| ANSI serialisation (`ink/output`, `ansi-tokenize`, `string-width`) | ~9% |
| Yoga layout (wasm) | ~1% |
| GC | ~4% |

The profile named `react.development.js` and `react-reconciler.development.js`. Nothing in
the published bundle set `NODE_ENV`, and `packages: 'external'` left React to be resolved
from the user's `node_modules` at runtime — so **every install ran React's development
build**. A static import is hoisted above any assignment the entry point could make, and an
external one cannot be inlined, so the fix is to bundle React with `process.env.NODE_ENV`
defined (`build.mjs`), which also dead-code-eliminates the development branches and takes
`es-toolkit`'s 12 MB out of the install.

| one full room render | CPU per render |
|---|---|
| development React | 31 ms |
| production React | 18 ms |
| dot instead of meters (0.5 renders/s instead of 10) | 1.2% of a core, against 30.7% |

Dropping the meter does not make a frame cheaper — it makes frames **rare**. The TUI's cost
is proportional to how often something on screen changes, and a ten-cell meter quantized to
80 steps changes whenever anyone breathes.

### After the two corrections

Both builds in the same room at the same moment, four clients, nobody talking:

| per client | before | after |
|---|---|---|
| engine | 17.1–17.7% | **6.1–6.4%** |
| TUI | 2.5–3.3% | **0.7–2.4%** |
| TUI resident | 216–225 MB | 177–203 MB |

In a silent room of four that is 20% of a core per client down to about 7%. The TUI's share
of the win shows fully only when people talk: with the meters moving it was 11–13%, and the
dot costs about 1% however loud the room is.

### What this says about the ceiling

The engine's remaining cost is structural, not tunable. `RTCAudioSource.onData` takes PCM,
and `@roamhq/wrtc` exposes no encoded path (no insertable streams, no encoded transform), so
every peer gets its own encoder, pacer, estimator and audio device module. A room of six is
five encoders for one microphone, and no amount of care in our code changes that. The way out
is a library that accepts a packet we already encoded — pion's `TrackLocalStaticRTP.WriteRTP`
writes one RTP packet to every bound PeerConnection — which is the argument in
[go-migration-analysis.md](go-migration-analysis.md).

## The Go client, same afternoon (branch `go-migration`)

Measured against real Node clients in the same room on this Mac; the full ledger and what
each change was worth are in `docs/go-migration-analysis.md` ("Spike results") and
`packages/go/README.md`. The headline numbers, one process with its TUI:

| state | Go | Node engine, before its TUI |
|---|---|---|
| devices open, room empty | 1.0%, 22 MB | — |
| receiving one continuous stream | 2.2%, 31 MB | 6.2%, 105 MB |
| both directions, continuous | 5.5% (4.4% at Opus complexity 5), 31 MB | 8.1%, 109 MB |
| three peers instead of one | no change | +two thirds |
| written to the terminal | 139 B/s | 90–100 KB/s |

Two measurement facts worth remembering when reading them: on macOS loopback, `sendto`
does the receiver's delivery in the sender's context, so every sender here pays for its
peer's kernel work; and a tone keeps the voice gate open, so "continuous" is a worst case a
conversation never reaches. The floor of the two devices themselves, in a C process with
callbacks that only copy, is 0.3% of a core.
