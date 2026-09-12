# openmeet — the Go client

One static binary per platform: the client. It speaks the repo's own signaling server and
the WebRTC contract in [`docs/websocket-webrtc-architecture.md`](../../docs/websocket-webrtc-architecture.md);
what it costs, and how to measure that again, is in [`docs/performance.md`](../../docs/performance.md).

**Status: audio, screen and camera, with the full interface, September 2026.** Every screen the Node
client has — first start, home, settings and its pickers, the audio setup with the mic test,
the room with its chat, participants, keys and debug panel — drawn cell for cell the same:
`internal/tui/testdata` holds frames captured from the Node client at 120x34 and
`golden_test.go` fails on any cell, colour or bold that differs. The Camera row still shows the
saved id rather than the enumerated name. What it does that the Node client cannot: encode the microphone
**once** and write the same packet to every peer, in one process, in tens of megabytes.

## Build and run

```bash
brew install opus            # libopus via cgo; miniaudio and pion need nothing
packages/go/scripts/build.sh              # → packages/go/openmeet, stamped with the package version
packages/go/openmeet                      # the home screen; --room standup goes straight in
                                          # name, colour and devices come from ~/.config/openmeet/settings.json
./openmeet --list-devices
./openmeet --room standup --headless --debug --cpuprofile cpu.prof
```

`--input-device` / `--output-device` match a substring of the name; `--no-voice-gate`
transmits continuously; the Audio Send setting (128 kbps by default) is the one encoder's bitrate and `--audio-kbps` overrides it for a run;
`--opus-complexity` its CPU lever (10 by default). Build with `-tags nolibopusfile` on a
machine without libopusfile; the client never uses it.

### Windows, cross-built from the Mac

```bash
brew install zig cmake pkg-config
packages/go/scripts/build-windows.sh      # → packages/go/dist/windows-amd64/openmeet.exe
```

One static PE, 12.7 MB, importing only system DLLs (UCRT, ole32, winmm): libopus is built
once for `x86_64-windows-gnu` with zig and cached under `.cross/`, miniaudio is in the tree.
On the test rig, `scripts/win/openmeet-go.cmd <room> [ws://mac-ip:3001/ws]` runs it with the
Roland as devices, next to the exe in `C:\Users\mvega\openmeet-go\`.

Run on the rig (Windows 11, i7-9700K) against a Node client on the Mac over the LAN, both
directions, the box sending continuously (`--no-voice-gate`) and decoding a tone:
**1.25% of one core, 25.9 MB working set** — no loopback penalty, no macOS thread-wake tax.
The exe enumerates the Roland and NVIDIA Broadcast through WASAPI; audio ran over an SSH
session, which on Windows is enough for sound (only screen capture needs the desktop).

## Releasing

One version number for every platform, in `VERSION`. A release is a tag:

```bash
echo 0.6.1 > packages/go/VERSION          # and whatever the release changes, committed
git tag v0.6.1 && git push && git push --tags
```

`go-client.yml` refuses a tag that disagrees with `VERSION`, builds both binaries on a macOS
runner (the only host that can link CoreAudio; Windows is a zig cross-build from there),
and publishes `openmeet-darwin-arm64`, `openmeet-windows-amd64.exe`, the installers, the
optional Windows Terminal scripts, the icon (the site's own favicon: brackets and the
speaking dot) and `SHA256SUMS` to a GitHub Release. Nothing is signed or
notarized yet: `install.sh` clears the quarantine flag, and Windows SmartScreen may ask once.

Installing and staying current, from the user's side:

```bash
curl -fsSL https://openmeet.manuelvega.dev/install | bash     # macOS
irm https://openmeet.manuelvega.dev/install.ps1 | iex         # Windows
```

Those two URLs are Cloudflare redirects to `releases/latest/download/install.{sh,ps1}` — a
line someone can read out, and one place to change if the binaries ever move.

The app then keeps itself current (`internal/update`): once a day it asks GitHub Releases,
downloads the asset for this OS beside the binary, checks that the download runs
(`--version`), and only then says so on the home screen — `→ v0.6.1` by the version,
`Update downloaded. Restart to install.` and `r` to swap and start again; quitting installs
it too. The swap is a rename, so it happens only once the process is about to exit (Windows
will not replace a running exe: it is renamed to `.old.exe` and removed on the next start).
The `Updates` setting turns it down to a notice, which prints the install command instead,
or off; `--no-auto-update` does the same for one run. A Homebrew tap is the obvious next
step for macOS and deliberately not done: the updater covers the same ground with no
formula to keep in step.

## Shape

| package | what |
|---|---|
| `internal/signal` | The WebSocket protocol, field for field with `packages/shared/src/types.ts` |
| `internal/rtc` | pion: one PeerConnection per peer, the three-transceiver contract, `polite = myID < peerID`, and **one `TrackLocalStaticRTP` bound to every connection** — the encode-once fan-out |
| `internal/audio` | miniaudio compiled in from `shim.c`, its callbacks in C feeding lock-free rings; a Go pump every 20 ms does capture → voice gate → Opus and keeps the playback ring fed from the playout (per-peer jitter buffer, Opus decode with PLC, mixer). No audio thread ever enters Go |
| `internal/tui` | The interface: a cell canvas drawn the way Ink drew it (`canvas.go`), the palette (`theme.go`), the chrome (`frame.go`, `chips.go`), one file per screen, and the Bubble Tea model with every key the Node client has (`model.go`). Bubble Tea writes only the lines that changed |
| `internal/engine` | The room session: signaling, the mesh, the pump, the stats, and the snapshots the interface draws from |
| `internal/settings` | The same `settings.json` the Node client keeps, field for field |

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
| **the whole client with its interface**, in a call | **3.9%, 35 MB** — the interface itself is 0.16% of a core (Bubble Tea's loop and `View` in the profile), 1 KB/s to the terminal | engine 8.2% + TUI 6–13%, 330 MB |

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
