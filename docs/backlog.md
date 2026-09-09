# Backlog

What is known to be missing or wrong, with enough context to pick it up cold. Ordered by
value within each section. Measurements live in [performance.md](performance.md).

## Correctness and consistency

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
`PARTICIPANTS_WIDTH` is 48 columns, from the widest one-line peer row:
`○ ▸ [MMMMMMMM] mcs ↓999k ~999ms 60% ██████████`. On the Windows profile's 110 columns that
leaves 62 for the chat. What is left to trim costs the reader something: dropping the `○`/`▸`
columns and carrying speaking and selection in the name's colour and weight (4 columns), or a
shorter meter. The two key rows in the column are 43 and 44 cells of the
46 available, so a longer label or another key needs one of the levers above first.

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

- **Automated npm publishing is broken.** `NPM_TOKEN` expired and the account requires 2FA,
  so 0.4.0 and 0.4.1 were published by hand. Needs a fresh automation token or npm trusted
  publishing (OIDC).
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
