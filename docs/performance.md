# What it costs, measured

The client's first priority is resource use, so every claim about it here is a measurement
on named hardware, with the way to take it again. Where a number from the retired Node
client appears it is because it is the comparison that explains a decision the code still
rests on — not as history.

**The machines.** *Mac*: Apple M4 Pro, 24 GB, macOS 15.7.9. *Windows*: i7-9700K, RTX 2080
SUPER, Windows 11, a Roland BRIDGE CAST X on both. Percentages are of **one** core.

## Taking the numbers again

```bash
packages/go/openmeet --room test --headless --debug          # the pump line, every 2 s
packages/go/openmeet --room test --headless --cpuprofile cpu.prof && go tool pprof cpu.prof
ps -o time=,rss= -p <pid>                                    # CPU as a delta over a window
```

`--debug` prints `pump: N late ticks, M ms ahead, K device underruns, capture F frames/s`
every two seconds: **late ticks are the number that matters**, because a late pump is a gap
in the audio. `audio:` on the first line says which devices are open, at what rate, and
which path they went through.

Two traps, both learnt by being caught by them:

- **Never measure a peer on the same machine.** On macOS loopback the sender's `sendto`
  does the receiver's delivery in the sender's own context, so a loopback peer charges its
  cost to whoever is being measured. Put the other end on the other machine.
- **A tone is a worst case.** It holds the voice gate open, so "continuous" numbers are a
  conversation that never pauses, which no conversation is.

## A call

One process — interface, audio and network together — on the Mac, against a real peer:

| state | CPU | memory |
|---|---|---|
| devices open, room empty | 1.0% | 22 MB |
| receiving one continuous stream | 2.2% | 31 MB |
| both directions, continuous | 5.5% (4.4% at Opus complexity 5) | 31 MB |
| the whole client in a call, interface included | **3.9%** | **35 MB** |
| the same on the Windows i7, sending continuously | **1.25%** | 25.9 MB |

The floor underneath all of it — the two devices in a C process whose callbacks only copy —
is **0.3%**. The rest is the codec, the network, and about 1% for Go waking a thread every
20 ms, which is the price of not being a native callback (see `packages/go/README.md`).

**It does not grow with the room.** The microphone is encoded once and the same packets go
to every peer, so the only thing a second listener costs is upload. Measured on the Mac with
receivers on the Windows box over the LAN, a sender at 256 kbps with the gate off:

| peers | 0 | 1 | 2 |
|---|---|---|---|
| sender's CPU | 5.88% | 5.08% | 5.84% |

That is the noise: per peer all that happens is SRTP and a `sendto`. A screen share is the
same shape — one encoder, one packetisation, N copies on the wire.

**The interface is 0.16% of a core and 139 B/s** to the terminal in a call, because Bubble
Tea writes only the cells that changed and nothing on screen changes ten times a second. The
speaking dot replaced a VU meter for exactly this reason: the meter was not expensive to
draw, it was expensive to draw *often* — measured at 8.5 full-screen repaints a second and
90–100 KB/s, paid twice, once to produce the frame and once by the terminal to paint it.

## Why the microphone is encoded once

This is the measurement the whole client is built on. From the Node client, whose binding
took PCM and gave every peer its own encoder:

| | CPU |
|---|---|
| **libopus itself**, stereo 128 kbps, 10 ms frames | **0.66%** |
| libopus, mono 32 kbps, 20 ms frames | 0.29% |
| one PeerConnection **carrying** that audio | **~7%** |
| a connected PeerConnection with no media | 0.2% |

The codec is not the cost and the language is not the cost: the machinery around one stream
is ten times the codec, and in a mesh it multiplies by the room. pion takes a packet already
encoded (`TrackLocalStaticRTP.WriteRTP` writes it to every bound connection), which is what
makes the table above flat.

## Audio, the rest of it

| what | cost |
|---|---|
| Apple's voice processing unit (Voice Isolation, echo cancellation, gain) | 12.9% capture / 6.1% duplex, against 2.9% raw |
| the polyphase resampler, any ratio the devices produce | 83–89 dB SNR, ~0.5% |
| the voice gate, while you are silent | nothing is encoded, sent or decoded anywhere |

Apple's unit is on by default despite costing four times the raw path, decided knowing the
number: what it buys — isolation, echo cancellation and levelling — is what a call sounds
like, and the cost lands in Apple's process. Windows has no equivalent of its own quality;
what it has is the communications category, which is free to us and worth whatever the
device's driver brings. `AutomaticGain` is ours, for the devices whose driver brings none.

Echo cancellation was verified rather than assumed: a BlackHole loopback playing the room
back into the microphone dropped from 60 kbps of gate-open audio to 5 kbps with the unit on.

## Video

Capture paths at 1080p, ffmpeg's own `-benchmark`, on the Windows box:

| path | CPU |
|---|---|
| `gdigrab` + CPU scale | 38% |
| `gdigrab` + scale + x264 veryfast | 65% |
| `ddagrab` + CPU scale | 29% |
| `ddagrab`, no scale, `dup_frames=true` | 41% |
| `ddagrab`, no scale, **`dup_frames=false`** | **3%** |
| `ddagrab` → **`h264_nvenc`** from D3D11 | **1%** |
| `ddagrab` → `scale_d3d11` | fails: `Could not create the texture (80070057)` |
| `ddagrab` → `hwmap=derive_device=cuda` / `vulkan` | fails: `-40` (ENOSYS) |

No GPU scaler works on this build by any route tested, which is why the NVENC path sends the
screen at its own size rather than paying a CPU colour conversion to cap it.

On the Mac, a 3096x1296 screen to 2580x1080 at 30 fps:

| path | CPU |
|---|---|
| `hwupload,scale_vt` — the pixels never leave the GPU | **29%** |
| any chain that scales or converts on the CPU | 103–133% |
| the Go process around it (splitting access units, packetising, sending) | 1.3% |
| `ffplay` showing a peer's share | 2.2% |

## On disk, and next to other things

| | installed |
|---|---|
| **openmeet** (the whole client: one binary) | **12 MB** |
| Discord | 479 MB |
| Google Chrome | 1.4 GB |

In a call the client holds ~35 MB and does not climb. Discord signed in and idle, in no
call, is 649 MB over seven processes; Google Meet in a tab adds 433 MB to a running browser.
