# openmeet — the Go client

One static binary per platform: the client. It speaks the repo's own signaling server and
the WebRTC contract in [`docs/websocket-webrtc-architecture.md`](../../docs/websocket-webrtc-architecture.md);
what it costs, and how to measure that again, is in [`docs/performance.md`](../../docs/performance.md).

**Status: audio, screen, camera and files, with the full interface, September 2026.** Every screen the Node
client has — first start, home, settings and its pickers, the audio setup with the mic test,
the room with its chat, participants, keys and debug panel — drawn cell for cell the same:
`internal/tui/testdata` holds frames captured from the Node client at 120x34 and
`golden_test.go` fails on any cell, colour or bold that differs. What it does that the Node client cannot: encode the microphone
**once** and write the same packet to every peer, in one process, in tens of megabytes.

## Build and run

```bash
brew install cmake pkg-config             # libopus is built once, statically, under .cross
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

`--headless` has two flags of its own for files, because there is no keyboard there to ask:
`--send-file <path>` shares one on joining, and `--accept-files` downloads everything the
room offers. Accepting is a keypress everywhere else, and these make that explicit rather
than assumed — they are also how a transfer is tested between two machines.

### Sharing a file

Drag a file onto the composer and it attaches as a chip; Enter sends it. Or press `ctrl+v`
(`ctrl+p` on Windows, where the terminal keeps `ctrl+v` for its own paste) to attach whatever
is on the clipboard — a file copied in the Finder or in Explorer, or an image, which is how a
screenshot gets shared: a terminal application can never receive one from a paste, so the
clipboard is read directly.

A file shared appears as a row in everyone's log. `f` opens the list: Enter downloads one
that is not here and previews one that is — Quick Look on macOS, the default application on
Windows, which has no Quick Look — `o` opens it and `r` shows it in its folder. Downloads
land in `~/Downloads/openmeet`.

**Nothing is pushed.** A file moves only when somebody asks for it, over a data channel on
the peer connection, so the server never holds one and never sees one; on a local network it
goes straight between the two machines at the speed of the link. The whole of it is in
[`docs/websocket-webrtc-architecture.md`](../../docs/websocket-webrtc-architecture.md) under
"Files".

### Windows, cross-built from the Mac

```bash
brew install zig cmake pkg-config
packages/go/scripts/build-windows.sh      # → packages/go/dist/windows-amd64/openmeet.exe
```

One static PE, 12.5 MB, importing only system DLLs (UCRT, ole32, winmm): libopus is built
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
$EDITOR CHANGELOG.md                      # [Unreleased] becomes [0.6.1] - <date>
git tag v0.6.1 && git push && git push --tags
```

The release is not finished at the tag: the workflow leaves the GitHub release body empty, and
that version's `CHANGELOG.md` section is copied into it by hand. `CONTRIBUTING.md` has the rules
and the command.

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

The app then keeps itself current (`internal/update`): on every start — and whenever you
press `u` on the home screen — it asks GitHub Releases, downloads the asset for this OS
beside the binary, checks that the download runs (`--version`), and only then says so — `→ v0.6.1` by the version,
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
| `internal/signal` | The WebSocket protocol, field for field with `packages/server/src/protocol.ts` |
| `internal/rtc` | pion: one PeerConnection per peer, the three-transceiver contract, `polite = myID < peerID`, and **one `TrackLocalStaticRTP` bound to every connection** — the encode-once fan-out. `data.go` is the data channels: one `control` per connection, then a channel of its own per file |
| `internal/files` | Sharing a file: what it is called and how big it is, the chunking and the backpressure, where a received one lands and how carefully it is named, and what each system means by opening or previewing it |
| `internal/audio` | miniaudio compiled in from `shim.c`, its callbacks in C feeding lock-free rings; a Go pump every 20 ms does capture → voice gate → Opus and keeps the playback ring fed from the playout (per-peer jitter buffer, Opus decode with PLC, mixer). No audio thread ever enters Go |
| `internal/tui` | The interface: a cell canvas drawn the way Ink drew it (`canvas.go`), the palette (`theme.go`), the chrome (`frame.go`, `chips.go`), one file per screen, and the Bubble Tea model with every key the Node client has (`model.go`). Bubble Tea writes only the lines that changed |
| `internal/engine` | The room session: signaling, the mesh, the pump, the stats, and the snapshots the interface draws from |
| `internal/settings` | The same `settings.json` the Node client keeps, field for field |

The voice gate is a port of the retired Node client's `src/lib/audio/voice-gate.ts`, constant
for constant, with the same tests (`go test ./...`). That client is no longer in the tree; git
keeps it at `terminal-v0.5.2`.

## What was learnt about the floor

A native client's audio callback does its work in place: CoreAudio wakes one thread and that
thread encodes, decodes and mixes. Go cannot be that thread cheaply — entering the runtime
from a foreign thread cost 1.9% for the devices alone against 0.3% in C — so the callback
stays in C and Go wakes once per 20 ms instead. That wake is the floor we pay for being Go:
about 1% of a core with everything else idle. Everything above it is the codec and the
network, which is what a call is.
