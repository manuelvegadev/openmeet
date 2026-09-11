# openmeet — the Go client

The migration target: one static binary that speaks the same signaling server and the same
WebRTC contract as `packages/terminal`, so the two share a room while this one grows. Why
Go, and why now, is in [`docs/go-migration-analysis.md`](../../docs/go-migration-analysis.md);
the numbers are in [`docs/performance.md`](../../docs/performance.md).

**Status: audio-only spike, September 2026.** It joins a room, talks and listens to Node
clients, shows who is on the air, and carries the chat. No video yet, no settings screen, no
device picker. What it already does that the Node client cannot: encode the microphone
**once** and write the same packet to every peer.

## Build and run

```bash
brew install opus            # libopus via cgo; miniaudio and pion need nothing
cd packages/go
go build -o openmeet ./cmd/openmeet
./openmeet --room standup    # name, colour and devices come from ~/.config/openmeet/settings.json
./openmeet --list-devices
./openmeet --room standup --headless --debug --cpuprofile cpu.prof
```

`--input-device` / `--output-device` match a substring of the name; `--no-voice-gate`
transmits continuously; `--audio-kbps` sets the one encoder (64 mono by default).

## Shape

| package | what |
|---|---|
| `internal/signal` | The WebSocket protocol, field for field with `packages/shared/src/types.ts` |
| `internal/rtc` | pion: one PeerConnection per peer, the three-transceiver contract, `polite = myID < peerID`, and **one `TrackLocalStaticRTP` bound to every connection** — the encode-once fan-out |
| `internal/audio` | miniaudio compiled in from `shim.c`, its callbacks in C feeding lock-free rings; a Go pump every 20 ms does capture → voice gate → Opus and keeps the playback ring fed from the playout (per-peer jitter buffer, Opus decode with PLC, mixer). No audio thread ever enters Go |
| `internal/tui` | Bubble Tea: participants with their dots, the chat, three keys. Repaints only changed lines |

The voice gate is a port of `packages/terminal/src/lib/audio/voice-gate.ts`, constant for
constant, with the same tests (`go test ./...`).

## What the spike measured (this Mac, M4 Pro, one Node peer sending a tone)

Same room, same moment, loopback. Note two things that inflate every absolute number here:
on macOS loopback the sender's `sendto` also does the receiver's delivery, and a tone keeps
the gate open — "someone talking without pause" — which a real call is not.

| | Go client (one process, TUI included) | Node engine alone |
|---|---|---|
| devices open, nobody in the room | 1.0%, 22 MB | — |
| receiving one continuous stream | **2.2%, 31 MB** | 6.2%, 105 MB (+ its TUI) |
| both directions, continuous, Opus complexity 10 | **5.5%, 31 MB** | 8.1%, 109 MB |
| both directions, complexity 5 | **4.4%** | — |
| **3 peers**, sending to all | flat with 1 peer | +two thirds |
| bytes written to the terminal | **139 B/s** | 90–100 KB/s |

Where the rest goes, from the profiles: the UDP `sendto` (~27% of the duplex profile,
loopback-inflated), the Opus encoder (~17% at complexity 10), and the Go scheduler waking a
thread for every pump (~24%: `findRunnable` → `kevent` → mach semaphore, ~100 µs a wake on
macOS). miniaudio's own C is 0.3% of a core — measured with the same devices in a C process.

## What was learnt about the floor

A native client's audio callback does its work in place: CoreAudio wakes one thread and that
thread encodes, decodes and mixes. Go cannot be that thread cheaply — entering the runtime
from a foreign thread cost 1.9% for the devices alone against 0.3% in C — so the callback
stays in C and Go wakes once per 20 ms instead. That wake is the floor we pay for being Go:
about 1% of a core with everything else idle. Everything above it is the codec and the
network, which is what a call is.
