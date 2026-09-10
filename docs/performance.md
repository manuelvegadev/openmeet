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
