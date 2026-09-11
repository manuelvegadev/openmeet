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
| `internal/audio` | miniaudio devices; capture → voice gate → Opus (off the audio thread); playout — per-peer jitter buffer, Opus decode with PLC, mixer |
| `internal/tui` | Bubble Tea: participants with their dots, the chat, three keys. Repaints only changed lines |

The voice gate is a port of `packages/terminal/src/lib/audio/voice-gate.ts`, constant for
constant, with the same tests (`go test ./...`).

## What the spike measured (this Mac, M4 Pro, one Node peer sending a tone)

| | Go client (one process, TUI included) | Node engine alone |
|---|---|---|
| 1 peer, sending and receiving | 7.8% of a core, 31 MB | 7.3%, 125 MB (+ the TUI process) |
| **3 peers**, sending to all | **7.6–8.0%, 33 MB** | 11.4–12.3%, 130 MB |
| receive only (muted) | 3.9–4.1%, 31 MB | 6.2% |
| bytes written to the terminal | **139 B/s** | 90–100 KB/s |

The number that matters is the second row: adding peers cost the Go client nothing, because
the microphone is encoded once. The remaining floor is C — libopus and miniaudio's callbacks
— and pion's per-packet path; the profile (`--cpuprofile`) shows where.

## Known limits of the spike

- The playout is the smallest correct version: reorder, Opus PLC for single losses, a
  prefill that deepens on real underruns, and a packet dropped when the buffer runs away for
  a whole second. No time-stretching yet, so a burst (libwebrtc sends ~100 packets in the
  first second of a connection) is trimmed 20 ms at a time. This is the part the migration is
  judged on; NetEq's design and speex's jitter buffer are the references.
- Opus in-band FEC is sent but not yet used on receive (`DecodeFEC`).
- No device-change watching, no Bluetooth-profile guard, no echo cancellation — the device
  problems in the backlog are this package's to answer.
