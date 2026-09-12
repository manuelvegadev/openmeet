# Changelog

All notable changes to OpenMeet are recorded here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is
below 1.0, so by clause 4 of that spec anything may still change at any time; 1.0 is macOS and
Windows at feature parity.

One version number covers every platform. What each platform actually supports is the support
matrix in the README, not a version of its own.

## [Unreleased]

## [0.6.3] - 2026-09-11

### Added

- `u` on the home screen checks for an update right now, whatever the last answer was, and says
  what it found either way — a button that answers nothing looks broken.

### Changed

- The update check runs on every start instead of once a day. The request is a kilobyte with a
  three-second deadline on a goroutine nobody waits for, and the point of an updater is that
  people get fixes; a five-minute floor keeps a relaunch from asking twice, and the stored
  answer is demoted to a fallback for a machine with no network.

### Fixed

- An update check that cannot read the answer now asks again instead of believing it. A client
  installed before the first binary shipped had stored `latestSeen: terminal-v0.5.2` — the
  retired npm package's tag, which is not a version number — so the comparison read "nothing
  newer" and the day-long cache kept it saying so. A machine on 0.6.1 could sit there
  indefinitely with 0.6.2 out. Both halves now refuse an answer that is not a version, so a
  client holding the bad value recovers by itself on its next start.
- Restarting into a new version keeps the terminal. The relaunch started the installed version
  and returned, so the process the shell was waiting on exited while its replacement was
  painting, and the prompt landed in the middle of the room.

## [0.6.2] - 2026-09-11

### Changed

- The installers leave a binary on your PATH and register nothing else. A shortcut has to name a
  terminal, and which terminal this runs in is the user's choice. Both Windows Terminal scripts
  still ship beside the binary and the installer prints the two lines that run them.
- The site shows one install line — the one for the machine reading the page — instead of two
  commands wrapped across three lines each.

### Removed

- The Windows installer no longer writes a Start Menu entry, a desktop shortcut or a Windows
  Terminal profile.

### Fixed

- A shared screen no longer falls behind. It drifted further back the longer it ran — about five
  seconds after half a minute — and on Windows it would then snap to live and break the picture
  on the way. Raw H.264 carries no timestamps, so the player assumed its default 25 fps while
  frames arrived at 30: six frames in for every five shown, without a ceiling. Naming the real
  rate would not have fixed it either, because a still desktop produces no frames at all, so
  every frame is now stamped with the moment it arrived.

## [0.6.1] - 2026-09-11

No changes. The same client as 0.6.0, published to exercise the updater end to end — check,
download, verify, swap and relaunch — on both platforms, so that a user would not be the one to
find out whether it worked.

## [0.6.0] - 2026-09-11

The client became a Go binary. Through 0.5.2 OpenMeet installed from npm and ran on Node and
Ink; it is now one static executable per system that asks for no runtime, no native modules and
no compiler.

### Added

- A static client binary for macOS (arm64) and Windows (amd64), released here and installed by
  `install.sh` / `install.ps1`.
- Screen sharing and camera over WebRTC as H.264 from the GPU encoder — VideoToolbox on macOS,
  NVENC with a gdigrab fallback on Windows — with one encoded stream per kind shared by every
  connection.
- Self-update: the client checks these releases, downloads beside its own executable, verifies
  the download by running it, and swaps it in on exit.
- Apple's Voice Processing I/O unit on macOS — voice isolation, echo cancellation, gain — on by
  default; on Windows the microphone opens in communications mode, which is how the endpoint's
  own echo cancellation and noise suppression are asked for. For interfaces that ship neither,
  a gain control of ours that levels the voice and does nothing else.
- A settings screen with sections and bars for what each choice costs and buys.
- Devices are watched and reopened when the system changes them, which is what keeps a Bluetooth
  headset switching profiles from turning robotic.

### Changed

- The microphone is encoded once for the whole room. Six people over libwebrtc meant five peer
  connections encoding the same microphone five times, because the old binding would only take
  raw PCM; pion accepts an RTP packet that is already encoded and fans it out to every peer, so
  the peer-to-peer mesh survives without paying for itself. Audio still goes client to client
  and through no server.
- The audio device callbacks stay in C and copy into lock-free rings — no audio thread enters Go
  — and the pump wakes every 20 ms on its own thread at audio priority. The playout measures its
  own jitter, rebuilds lost packets from FEC, and catches up during silence rather than speech.
- Devices open at their own sample rate and a polyphase resampler converts in both directions,
  instead of letting the audio library interpolate.
- The interface is redrawn cell for cell from the Ink client, with the original frames kept as
  tests. The settings screen is the one deliberate exception.

### Removed

- The Node/Ink client. `openmeet-terminal` 0.5.2 is its last version on npm and nothing can
  publish another; the package stays in the tree as the reference the Go interface was drawn
  from.

### Known limitations

- The camera is macOS only. Windows is rooms, audio, chat and screen sharing.
- A restrictive NAT on both ends needs a TURN server, which is not included.

---

Versions before 0.6.0 were the Node client, published to npm as `openmeet-terminal` under
`terminal-v*` tags. They are not restated here; their releases remain on the
[tags page](https://github.com/manuelvegadev/openmeet/tags).

[Unreleased]: https://github.com/manuelvegadev/openmeet/compare/v0.6.3...HEAD
[0.6.3]: https://github.com/manuelvegadev/openmeet/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/manuelvegadev/openmeet/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/manuelvegadev/openmeet/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/manuelvegadev/openmeet/compare/terminal-v0.5.2...v0.6.0
