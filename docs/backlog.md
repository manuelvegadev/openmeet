# Backlog

What is known to be missing or wrong, with enough context to pick it up cold. Ordered by
value within each section. Measurements live in [performance.md](performance.md).

## The Go client: parity items deferred on purpose (Sept 2026)

Decided 2026-09-11: reconnection, screen and camera, distribution and updates, and the
retirement of the Node client come first; these are left for after, and each is small.

- **Settings rows that show but do not act yet in Go**: Mic Channels and input gain
  (port `packages/terminal/src/lib/audio/channels.ts` — the auto mono-in-a-stereo-pair
  detection and the dB gain — as a step before the gate), Audio Send kbps (wire it to the
  one Opus encoder; Audio Receive is moot with encode-once, peers choose their own), Noise
  Suppression on Windows (open WASAPI in the *Communications* category, which is Windows'
  own voice processing and the Windows Studio Effects where the machine has them; the
  macOS row is served by Apple's unit), and `--debug` writing `debug.log` next to the
  settings as the Node client did.
- **Camera row** with the enumerated name rather than the saved id (comes with video).
- **The RTX hint**: the PowerShell probe that suggests NVIDIA Broadcast to an RTX owner
  who has not installed it (`nvidia-broadcast.ts` `hasRtxGpu`).
- **Pause Rendering**: the setting cycles but does nothing; Bubble Tea repaints only on
  events so the cost is cosmetic. Focus reporting (`tea.WithReportFocus`) would cover
  `unfocused`; `minimized` needs the Node client's window watcher.
- **Peer name clamping** to `NameMaxCells` on receive (`engine.cleanName` exists, unused).
- **DSCP on Windows** through the qWAVE API, per destination, once the peer's address is
  known; `IP_TOS` alone is ignored there.
- **Video overlay**: with compressed H.264 to ffplay there is nothing to burn text into;
  the window title carries the peer's name instead, and the setting row should say so.

## Correctness and consistency

### Audio devices, from testing on other people's machines (Sept 2026)
Three reports, all in the device layer, all worth fixing where the Go client will put that
layer (see [go-migration-analysis.md](go-migration-analysis.md), "Device problems the Go
client has to answer for"):

- **The Elgato Wave's effects are missing from what we capture (macOS).** Wave Link exposes
  its processed audio as separate virtual devices; picking the hardware input gets the signal
  from before the noise suppression and the EQ. Confirm device by device, then either prefer
  the processed endpoint or label it in the picker — `audio/nvidia-broadcast.ts` already
  reasons exactly this way for the Windows equivalent.
- **AirPods ruin the incoming audio (macOS).** Opening a Bluetooth device for input while it
  is also the output puts macOS into the hands-free profile: mono, 8–16 kHz, telephone. Never
  open a Bluetooth input alongside a Bluetooth output, and say why in the picker.
  `scripts/audio-matrix.ts` on an AirPods pair will show the rate collapse.
- **Devices come and go unnoticed (Windows).** The list is enumerated once and RtAudio sends
  no device-change notification (gotcha 21e), so a headset connected after the picker opened
  is not there, and NVIDIA Broadcast is present or absent depending on when we looked. Needs
  a device-change watch (`IMMNotificationClient`, `kAudioHardwarePropertyDevices`) and a
  re-enumeration, not a longer cache.

### The screen bandwidth budget is bounded by the estimator, not clamped per frame
`b=AS` (gotcha 27b) sets what the bandwidth estimator will offer the encoder towards a peer,
and follows the room and the share's shape on every renegotiation. What it is not is a hard
per-frame clamp: on pathological content (noise at 1080p) VP8's screenshare mode overshoots
both this and the frozen `sendEncodings.maxBitrate`. A browser-grade clamp needs
`setParameters` after negotiation, which this wrtc refuses. Worth re-probing on a newer
@roamhq/wrtc; `scripts/share-probe.ts` is where to assert it.

### The screen bitrate cap and priority may not survive on the answerer either
Gotcha 33 fixed the offerer's round-trip through `getParameters()`. The answerer never gets
any of it (gotcha 30g), and the read-back drops `priority` everywhere, so what the allocator
actually holds for audio (`priority: 'high'`) after any future `setParameters` on that sender
is unverified. `scripts/share-probe.ts` is the place to assert it once `getParameters()` can
be trusted, or once a newer wrtc build reads the fields correctly.

### The participants column could be narrower
Partly done, Sept 2026: the VU meter left the room (gotchas 37–38) and `PARTICIPANTS_WIDTH`
follows the widest line it can hold, so the column narrowed by ten columns on its own and the
chat got them. What is left to trim still costs the reader something: dropping the `○`/`▸`
columns and carrying speaking and selection in the name's colour and weight would save four
more. Check the two key rows in the column still fit before taking them.

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
`room-view` derives `peerCam`/`peerScreen` from the same conditions its `useInput` handler
checks, kept in step by a comment, and now four rows draw from that state (`MyActions`,
`PeerActions`, the chat's own chip, `RoomBar`). They have been out of step twice: `s share
screen` was drawn unconditionally while with video disabled the engine built no
`VideoManager`, and `d`/`o` were live keys no row advertised — both fixed, neither by
construction. One keymap — `{ key, label(state), enabled(state), scope, run() }[]` — with
`useInput` dispatching from it and each row rendering `filter(scope)` would make "a drawn
button works, a working key is drawn" hold by itself.

### The engine learns user choices two ways
`room-engine` receives most settings through `JoinOptions` but still calls `loadSettings()`
itself for `videoOverlay` and `videoDeviceId`. Pick one direction.

## Unverified

- **NVIDIA Broadcast: whether echo is actually gone.** Everything mechanical is verified on
  the real box (RTX 2080 SUPER): the endpoint is named `Microphone (NVIDIA Broadcast)`, the
  picker offers it first and labelled, it opens at 48 kHz, `debug.log` says
  `Noise suppression: left to NVIDIA Broadcast (GPU)`, and a Mac↔Windows call carried audio
  both ways. What no test can answer is the point of the feature — that echo is gone on
  speakers, and that the denoiser does not chew up speech. That needs a person listening.
- **The RTX hint has never been seen.** It only renders on a machine with an RTX and *no*
  Broadcast; the one RTX box available has Broadcast installed. The probe itself is verified
  (`hasRtxGpu() = true`, 191 ms cold), so only the two lines of JSX are unexercised.
- **`ddagrab` `output_idx` with more than one monitor.** It is taken from the order
  `Screen.AllScreens` enumerates, which matches DXGI on a single-adapter machine but is not
  guaranteed to. Verified with one monitor only; a multi-monitor or multi-GPU box may need a
  real `DXGI_OUTPUT_DESC.DeviceName` lookup.
- **`install.sh` end to end.** The URL was corrected but only the PowerShell installer has
  been run on a clean machine.

## Known costs we chose to accept

- **Displayed frames dropped at 1080p.** Roughly 257 of 301 reach ffplay, because frames now
  arrive at full resolution (3.1 MB) instead of a rescaled 720p (1.4 MB) and the pipe cannot
  always keep up, so the backpressure guard drops some. ~25 fps at full resolution against 30
  fps at 56% of the pixels; for screen content that is the better side. Revisit if it ever
  shows on a webcam stream.
- **`incrementalRendering` is off**, so every frame is a full repaint: 117 KB/s against
  12 KB/s, and 0.19 ms per write on ConPTY. The narrower fix is upstream — Ink resets its
  incremental baseline only when the terminal *narrows* (`ink.js`, `currentWidth <
  lastTerminalWidth`), where `!==` would cover widening too. A one-comparison `pnpm patch`
  would buy incremental rendering back for the ~100% of frames that are not resizes.
- **A 16-colour terminal still follows its own theme.** Hex degrades to palette indices
  there. 256-colour and truecolor are covered because indices ≥ 16 are fixed by the xterm
  spec.

### macOS screen capture should move off `AVCaptureScreenInput`
ffmpeg's avfoundation grabs the screen through `AVCaptureScreenInput`, deprecated since
macOS 15. Its failure mode is silence: on 2026-09-09, after a 28-minute share, every new
capture from the same terminal app ran at 20% CPU and never produced a byte, while
`screencapture -x` and the same client from Terminal.app worked — the wedge is per hosting
app and only quitting it clears it. The watchdog (gotcha 16) now reports it instead of
hanging; the fix is a native ScreenCaptureKit source (a small Swift helper writing I420 to a
pipe, or ffmpeg once it grows an SCK input), which would also drop the deprecated-API
warnings and the `NSKVONotifying_AVCaptureScreenInput` noise.

## Bigger bets, in rough order of appeal

### Take video off WebRTC and encode with NVENC
Measured on the Windows box: `ddagrab` → `h264_nvenc` straight from D3D11 costs **1% of a
core**, against 65% for the software path. It would also encode **once** regardless of peer
count, which fixes the mesh's ×(N−1) CPU without an SFU. The cost is everything WebRTC gives
away for free: congestion control, pacing, keyframes on request, and a DataChannel in
unreliable/unordered mode. A mini video protocol — but the right architecture if the app
becomes "share a screen with audio" more than "a video call".

### An SFU
One upload instead of N−1, and one encoder instead of N−1; `@roamhq/wrtc` already offers
simulcast (`a=rid:l/m/h`, verified), which is useless in a mesh and the whole point with an
SFU. mediasoup 3.12+ ships a prebuilt worker, so it installs without a compiler. The real
obstacles: Cloudflare proxies no UDP (media needs a DNS-only record, which exposes the origin
IP), a UDP port range in Docker, ~9 GB/hour of server traffic for a 5-person room, no
end-to-end encryption any more, and `mediasoup-client` has no official handler for
`@roamhq/wrtc` — `mediasoup-client-node` is a third party and is the piece to derisk first.

### Echo cancellation
Deferred everywhere except Windows + RTX, headphones-first. We push PCM through
`RTCAudioSource.onData`, which bypasses libwebrtc's audio processing module entirely, and
Windows' driver AEC would need `AudioCategory_Communications`, which RtAudio does not set.
NVIDIA Broadcast is now recognised (`audio/nvidia-broadcast.ts`), which covers RTX machines
and nothing else; macOS and non-RTX Windows still have no answer but headphones. The routes
worth costing if it ever matters: WebRTC's own APM fed a reference signal, or speexdsp's AEC
as a `CaptureProcessor` — the latter needs the playback frame that `FrameMixer` already has,
so the plumbing is short; the hard part is the capture/playback delay estimate.

## Chores

- **Deprecate `openmeet-terminal` on npm.** The package is retired (0.5.2 is the last
  version) and its README says so, but npm itself does not yet: run
  `npm deprecate openmeet-terminal "OpenMeet is now a single binary: https://openmeet.manuelvega.dev"`
  once, logged in with 2FA. The publish workflow is gone, so nothing can be published by
  accident.
- **Sign and notarize the binaries.** `install.sh` clears the quarantine flag and SmartScreen
  may ask once on Windows; a Developer ID and an Authenticode certificate would remove both
  steps, and the updater would then verify a signature rather than only that `--version` runs.
- **`scripts/av-bench.ts` reimplements the audio path** rather than driving `AudioManager`,
  which always constructs its own backend. Injecting an `AudioBackend` (the interface is just
  `onCapture`/`onPlayback` at 10 ms) would let the bench drive the real pipeline with a
  timer-backed fake, so a change to the capture path can no longer be invisible to it.
- **`dimColor` is still the prop name** on our `Text`, remapped to an explicit grey. Renaming
  it `muted` would make any remaining `dimColor` unambiguously a bypass, and greppable. 39
  call sites.
- **Test scripts left on the Windows box**: `capbench.ps1`, `avbench.ps1`, `avbench.cmd` and
  the `openmeet-capbench` / `openmeet-avbench` scheduled tasks. Kept on purpose, to re-measure.
- **`RELEASE.md`** at the repo root is an untracked 0.3.0-era draft. Delete or rewrite.
