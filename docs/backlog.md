# Backlog

What is known to be missing or wrong, with enough context to pick it up cold. Ordered by
value within each section. Measurements live in [performance.md](performance.md).

## Small and known

Each of these is a thing the client does not do yet, with the reason it has not mattered.
The settings rows that had nothing behind them were removed rather than left lying; their
fields stay in `settings.json` (see the note on `settings.App`) and what is left of each is
here.

- **Mic Channels.** A microphone wired to input 1 of a stereo pair is averaged with a silent
  channel: 6 dB down and noisier. The auto mono-in-a-stereo-pair detection belongs as a step
  before the gate (the retired client's `packages/terminal/src/lib/audio/channels.ts` is the
  working version to port). Bring the settings row back with it.
- **`--debug` writing a log file** next to the settings, so a report can be a file rather
  than a screenshot of the debug panel.
- **The RTX hint**: suggest NVIDIA Broadcast to someone who has an RTX and has not installed
  it. A cached PowerShell probe; the retired client's `nvidia-broadcast.ts` has it.
- **Pause Rendering.** Bubble Tea repaints only on events, so the cost is cosmetic. Focus
  reporting (`tea.WithReportFocus`) would cover `unfocused`; `minimized` needs a window
  watcher per platform.
- **Peer name clamping** to `NameMaxCells` on receive (`engine.cleanName` exists, unused).
- **DSCP on Windows** through the qWAVE API, per destination, once the peer's address is
  known; `IP_TOS` alone is ignored there.
- **The video overlay.** With compressed H.264 going to ffplay there is nothing to burn text
  into, so a peer's name lives in the window title. Worth a line in the settings if the row
  ever comes back.
- **Settings from inside a room.** Today it is reachable only from the home screen, which is
  why every row can say "applies when you next join". Opening it in a call would make that
  mark mean something: what changes live (devices, volume) against what waits.

## Correctness and consistency

### Audio devices, from testing on other people's machines
All three are answered in the client now, and all three are answered from theory rather than
from the machine that reported them — they are here until someone with that hardware says so:

- **The Elgato Wave's effects (macOS).** A raw Wave microphone now points at its Wave Link FX
  sibling in the picker, which is where the noise suppression and the EQ are. Never confirmed
  on the Wave itself.
- **Bluetooth headsets (macOS).** Opening one for input while it is also the output puts
  macOS into the hands-free profile: mono, 8–16 kHz, telephone. The picker says so, and the
  pump follows the rate change instead of turning robotic — verified on Galaxy Buds 3 Pro,
  not on AirPods.
- **Devices coming and going (Windows).** Watched now through miniaudio's stop/reroute
  notifications; verified by a hot swap on the rig, not by a headset arriving mid-call.

### The participants column could be narrower
`ParticipantsWidth` is measured from the widest line the column can hold, so it is already
as narrow as its contents allow. What is left costs the reader something: dropping the
`○`/`▸` columns and carrying speaking and selection in the name's colour and weight would
save four more. Check the two key rows in the column still fit before taking them.

### Joining a room that does not exist silently creates it
`signaling.ts` calls `ensureRoom` on `join-room`, so a typo in the room name lands you alone
in a room of your own with no error — and since the create step was removed, that is now the
only way in. `GET /api/rooms/:id` already 404s; either consult it before joining or add a
flag to `join-room` so the server can answer "no such room" and the TUI can offer to create
it. Changes the protocol, so it is not a drive-by.

### `POST /api/rooms` is unused, and its rooms are never collected
The TUI no longer calls it. `removeParticipant` only sweeps a room when someone disconnects,
so a room created through the endpoint and never joined stays in the map until the server
restarts. Either delete the endpoint or give it a TTL.

### The key rows mirror the keymap by hand
`internal/tui/room.go` decides which chips to draw from the same state `keyRoom` in
`model.go` dispatches on, kept in step by reading both. It has been wrong before in the Node
client it was drawn from — a button drawn for a key that did nothing, and live keys no row
advertised. One keymap — `{key, label(state), enabled(state), scope, run()}` — dispatched by
the key handler and filtered by each row would make "a drawn button works, a working key is
drawn" hold by construction. The settings screen already went half way: `RowsForTab` is the
one list both its drawing and its keys walk.

## Unverified

- **NVIDIA Broadcast: whether echo is actually gone.** Everything mechanical is verified on
  the real box (RTX 2080 SUPER): the endpoint enumerates as `Microphone (NVIDIA Broadcast)`,
  the picker offers it first and labelled, it opens at 48 kHz, and a Mac↔Windows call carried
  audio both ways. What no test can answer is the point of the feature — that echo is gone on
  speakers, and that the denoiser does not chew up speech. That needs a person listening.
- **Windows' communications mode, on a machine whose driver brings something.** Verified that
  the stream opens in that category on the rig and captures cleanly; the Roland's driver
  appears to add nothing, so what the mode is worth where it *does* apply is untested.
- **`ddagrab` `output_idx` with more than one monitor.** It is taken from the order
  `Screen.AllScreens` enumerates, which matches DXGI on a single-adapter machine but is not
  guaranteed to. Verified with one monitor only; a multi-monitor or multi-GPU box may need a
  real `DXGI_OUTPUT_DESC.DeviceName` lookup.
- **`install.sh` end to end.** The URL was corrected but only the PowerShell installer has
  been run on a clean machine.

## Known costs we chose to accept

- **A 16-colour terminal still follows its own theme.** Hex degrades to palette indices
  there. 256-colour and truecolor are covered because indices ≥ 16 are fixed by the xterm
  spec.

### macOS screen capture should move off `AVCaptureScreenInput`
ffmpeg's avfoundation grabs the screen through `AVCaptureScreenInput`, deprecated since
macOS 15. Its failure mode is silence: on 2026-09-09, after a 28-minute share, every new
capture from the same terminal app ran at 20% CPU and never produced a byte, while
`screencapture -x` and the same client from Terminal.app worked — the wedge is per hosting
app and only quitting it clears it. The watchdog reports it instead of hanging —
eight seconds without a byte ends the share with the remedy in the room log; the fix is a native ScreenCaptureKit source (a small Swift helper writing I420 to a
pipe, or ffmpeg once it grows an SCK input), which would also drop the deprecated-API
warnings and the `NSKVONotifying_AVCaptureScreenInput` noise.

## Bigger bets, in rough order of appeal

### An SFU for the screen share, and only if it can stay private (asked for 11 Sept 2026)
The mesh's remaining cost is the **upload**, and only the sender's: the Go client already
encodes once and writes the same packets to everyone, and measuring 0, 1 and 2 real
receivers moved its CPU 5.88% → 5.08% → 5.84% of a core, which is the noise. So an SFU
would buy exactly one thing — one copy out of your link instead of one per viewer. At the
per-viewer rate the settings now use, five people watching a 2500 kbps share is 12.5 Mbps
up; through an SFU it would be 2500 kbps, whoever is watching, which is how Discord and
Twitch stay flat.

The reason we do not have one is not difficulty, it is that an ordinary SFU terminates
DTLS-SRTP: it decrypts every frame to forward it, so the server can watch the call. That is
the one thing this app promises not to do. **What to research is whether that is avoidable,
because it looks like it is.**

The route, in the order it should be derisked:

- **SFrame (RFC 9605).** Encrypt the media frame with a key the server never has, *before*
  packetisation; the SFU sees RTP headers — enough to forward, to drop, to answer NACK and
  PLI — and never the payload. Our own code is unusually ready for it: `videoTrack.write`
  in `internal/rtc/peers.go` already packetises access units itself, so encryption is one
  call on the way in and its mirror before `samplebuilder` on the way out. The cipher is
  AES-GCM, which is what SRTP already runs on every packet today without showing up in a
  profile: both target machines do it in hardware (AES-NI, ARMv8 crypto), around a GB/s per
  core against a 2500 kbps stream. Cheap is not the hard part.
- **Getting the key to the room without the server.** This is the hard part, and we are in a
  good position for it: **audio stays peer to peer whatever happens**, so every participant
  already has an authenticated DTLS channel to every other one. A room key handed over those
  connections never touches the server. Rotation on join and leave is the messy bit (MLS,
  RFC 9420, is the grown-up answer); a shared passphrase is the cheap one worth prototyping
  first to see whether the rest holds.
- **What E2EE does not hide.** The server still sees who is in which room, when, and how much
  each of them sends. Media stays private; the shape of the call does not.
- **Congestion control becomes ours.** In a mesh each connection adapts to its own peer. Behind
  an SFU with one encoding, the slowest viewer sets nothing and simply loses packets; doing it
  properly means simulcast or SVC, and simulcast means several encoders again — which is the
  cost an SFU was supposed to remove. Worth measuring before assuming.
- **Operations.** ~9 GB/hour of server traffic for a 5-person room, a UDP port range in Docker,
  and Cloudflare proxies no UDP (media needs a DNS-only record, which exposes the origin IP).
  A minimal forwarder in Go with pion is plausible — we already own the packet path — and with
  SFrame it does not even need the keys.

Scope it to **video and the screen share only**. Audio is 128 kbps per peer, 640 kbps with the
room full: it costs nothing to keep in the mesh and everything to give away.

### Take video off WebRTC and encode with NVENC
Measured on the Windows box: `ddagrab` → `h264_nvenc` straight from D3D11 costs **1% of a
core**, against 65% for the software path. It would also encode **once** regardless of peer
count — which the Go client now does anyway, through pion, while keeping congestion control,
pacing, keyframes on request and everything else WebRTC gives away for free. Left here as the
record of the measurement; the reason to revisit it would be latency, not CPU.

### Echo cancellation where the system has none
macOS has Apple's voice processing unit and it is on by default. Windows opens the capture in
the communications category, which gets whatever the endpoint's driver provides — a laptop
microphone usually brings echo cancellation, a USB interface often brings nothing, and
Windows Studio Effects needs a machine with an NPU. So on a desktop with an interface and
speakers, there is still no answer but headphones or NVIDIA Broadcast.

Ours would be speexdsp's AEC as a step before the gate: it needs the playback frame, which
the mixer already has in the same 20 ms tick, so the plumbing is short. The hard part is the
capture/playback delay estimate, and the reason not to start is that it is a lot of signal
processing to maintain for the one case the system does not already cover.

## Chores

- **Deprecate `openmeet-terminal` on npm.** The package is retired (0.5.2 is the last
  version) and its README says so, but npm itself does not yet: run
  `npm deprecate openmeet-terminal "OpenMeet is now a single binary: https://openmeet.manuelvega.dev"`
  once, logged in with 2FA. The publish workflow is gone, so nothing can be published by
  accident.
- **Sign and notarize the binaries.** `install.sh` clears the quarantine flag and SmartScreen
  may ask once on Windows; a Developer ID and an Authenticode certificate would remove both
  steps, and the updater would then verify a signature rather than only that `--version` runs.
- **Test scripts left on the Windows box**: `capbench.ps1`, `avbench.ps1`, `avbench.cmd` and
  the `openmeet-capbench` / `openmeet-avbench` scheduled tasks. Kept on purpose, to re-measure.
