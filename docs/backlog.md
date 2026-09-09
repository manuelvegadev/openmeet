# Backlog

What is known to be missing or wrong, with enough context to pick it up cold. Ordered by
value within each section. Measurements live in [performance.md](performance.md).

## Correctness and consistency

### The theme does not cover third-party components
`lib/theme.ts` and `components/text.tsx` make our own text terminal-independent, but
`ink-select-input` renders its items with `color: isSelected ? 'blue' : undefined` and its
pointer with `color="blue"`, and `ink-text-input` renders the placeholder with `chalk.grey`
and the typed value with no foreground at all. That is 7 `SelectInput` sites (device-picker,
room-view, settings-view) and 3 `TextInput` sites (chat-input, home-screen) — including the
room name you type and the messages you type. Both failure modes the theme exists to remove:
a named ANSI index whose hue is the terminal's, and a default foreground that is black over
the painted `#0B0B0B` on a light-theme terminal.

`SelectInput` accepts `itemComponent`/`indicatorComponent`, so one `components/select.tsx`
built on our `Text` covers all 7 at once; `TextInput` can be nested inside a
`<Text color={theme.text}>`. Worth adding a Biome `noRestrictedImports` for `Text` from
`ink` outside `components/text.tsx` afterwards, so the rule is enforced and not remembered.

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

### The status bar mirrors the keymap by hand
`room-view` derives `peerCam`/`peerScreen` from the same conditions its `useInput` handler
checks, kept in step by a comment. They are already out of step: `s share screen` is drawn
unconditionally but with `--no-video` the engine builds no `VideoManager`, and `d` (change
device) and `o` (overlay) are live keys no bar advertises. One keymap —
`{ key, label(state), enabled(state), run() }[]` — with `useInput` dispatching from it and
`StatusBar` rendering `filter(enabled)` would make "a drawn button works, a working key is
drawn" hold by construction.

### `screenBitrateFor` reads like a policy but behaves per-peer
`MESH_UPLINK_BUDGET` is divided by the peer count *at connection time*, and gotcha 27 means
a connection keeps that ceiling until it renegotiates. So the first peer's connection is
capped at the full 2.5 Mbps forever while the fifth gets 1.2 Mbps, and the budget bounds
nothing in aggregate. Either own it at room level and renegotiate on participant change (the
screen-share path already renegotiates, so the hook exists), or drop the arithmetic and ship
one honest constant.

### The engine learns user choices two ways
`room-engine` receives most settings through `JoinOptions` but still calls `loadSettings()`
itself for `videoOverlay` and `videoDeviceId`. Pick one direction.

## Unverified

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
Deferred, headphones-first. We push PCM through `RTCAudioSource.onData`, which bypasses
libwebrtc's audio processing module entirely, and Windows' driver AEC would need
`AudioCategory_Communications`, which RtAudio does not set. On an RTX machine, NVIDIA
Broadcast's virtual microphone already gives GPU noise removal and echo cancellation with no
code at all — it enumerates as an ordinary WASAPI endpoint.

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
