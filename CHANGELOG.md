# Changelog

All notable changes to OpenMeet are recorded here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is
below 1.0, so by clause 4 of that spec anything may still change at any time; 1.0 is macOS and
Windows at feature parity.

One version number covers every platform. What each platform actually supports is the support
matrix in the README, not a version of its own.

## [Unreleased]

### Added

- **A `File Transfer` setting, and a transfer that gets out of the voice's way.** Until now a
  file was held to 2 Mbps whenever the other person was not on your network, which made a
  5 GB file a six-hour affair however fast your link. The default is now `voice first`: the
  transfer takes whatever the link has spare and gives it back the moment the call starts to
  suffer. `unlimited` never gives it back, and `2 Mbps` is the old flat ceiling for anyone who
  prefers it. On your own network nothing has changed — there was never a ceiling there.

  Worth knowing why it is done this way: a file and the voice travel in the same encrypted
  connection on the same socket, so no amount of network priority marking can tell a router
  which is which. The only thing that can is the app, by watching the call's round trip and
  backing off when a queue starts building — which is what `voice first` does.

### Changed

- Bubbles sit against each other in the conversation instead of with a blank row between
  them, which fits more of it on screen.

## [0.8.0] - 2026-09-15

### Added

- **Files can be shared in a room.** Drag one onto the composer and it attaches as a chip
  next to what you are typing; Enter sends it, and it appears as a row in everyone's log with
  its name, its size and a three-letter mark for what it is — `aud`, `vid`, `img`, `zip` or
  `doc`. `f` opens the list of everything the room has offered: Enter downloads one that is
  not here yet and previews one that is, `o` opens it in whatever the system opens it with,
  and `r` shows it in its folder. Received files land in `~/Downloads/openmeet`
  (`%USERPROFILE%\Downloads\openmeet` on Windows) under a name that is checked before it is
  used, numbered rather than overwritten if one of that name is already there, and verified
  against the size and digest that were announced.
- **A screenshot can be shared from the clipboard**, with `ctrl+v` — `ctrl+p` on Windows,
  where the terminal keeps `ctrl+v` for its own paste. A terminal application can never
  receive an image from a paste, because the terminal turns the clipboard into text and a
  clipboard holding a PNG has no text to give, so the clipboard is read directly instead. A
  file copied in the Finder or in Explorer attaches as that file. Neither works over SSH,
  where the clipboard is on the other machine, and the app says so rather than failing
  silently.
- **Nothing is pushed, and nothing passes through the server.** A file is announced over the
  signaling connection and then moves only when somebody asks for it, over a data channel on
  the peer connection the call already has — so it is encrypted by the same handshake that
  protects the voice, and the server never holds a file or sees one. Between two machines on
  the same network it goes directly between them at the speed of the link; anywhere else it
  is held to 2000 kbps, because a transfer is not the call and the uplink has to carry both.
  A transfer never delays the audio pump.
- `--headless` gained `--send-file <path>` and `--accept-files`, which are how a transfer is
  driven from a script and tested between two machines. Accepting a file is a keypress
  everywhere else; with no keyboard there, the flag is what asks for it.

### Changed

- **The conversation is drawn as bubbles.** A message is a box on the side it came from —
  yours on the right in the theme's colour, theirs on the left in grey — with the name in
  brackets and the time on the outer edge. Several messages in a row from one person share a
  box, so a conversation costs fewer rows than a box each. A room event (somebody joining,
  muting, sharing a screen) is centred and plain, because nobody said it. And the composer
  floats in a rounded box of its own, which takes the theme's colour while it has the focus,
  so tab moving between the conversation and the composer is visible at a glance.
- **A shared file is a card across the whole width**, with what it is, how big, who shared it
  and when, and its buttons inside it: download, or open, show in the folder, and — on macOS,
  which has Quick Look — preview. It no longer prints where it saved the file: every file
  lands in the same folder and "in folder" is the button that goes there. A file that has
  arrived is marked with a green check beside its name.
- **Below 90×28 the room says the window is too small** instead of drawing itself squeezed
  into a frame with its middle missing.
- **The WebRTC connection contract now has a fourth m-line.** Every offer this client makes
  is audio, webcam, screen, then the control data channel — in that order, always. A client
  from before this release offers no such section, and a room with one in it works exactly as
  it did minus the files. Nothing else about the contract moved.

## [0.7.0] - 2026-09-13

### Added

- The mouse works. Every button on screen is clickable and does exactly what its key does, the
  wheel scrolls whichever pane the pointer is over — the conversation, the participants, the
  settings, a picker — and clicking a participant selects them, clicking the composer focuses
  it, clicking the participants pane goes back to the controls.
- The conversation can be selected with the mouse and copied. The selection is the
  application's own rather than the terminal's, which is the point: it holds text and never
  the frame around it, so no borders, no rule, no participants pane come along with it, and a
  message that wrapped over four rows copies as the one line it is instead of four. Double
  click takes a word, triple click the whole line, and the row over the composer names the key
  that copies it. The debug panel is selectable the same way, and a line it drew clipped still
  copies whole.
- **`Cmd+C` copies the selection on macOS**, and the row over the composer names the chord the
  way the system a person is sitting at names it: `⌘C` once the terminal has said it can send
  it, `Ctrl+C` on Windows, `ctrl+c` elsewhere. A chord with Cmd in it has no bytes in the encoding a
  terminal has used since the seventies, which is why it has never reached a terminal
  application — pressing it did nothing anywhere. The kitty keyboard protocol is the way to be
  told, so the client now asks the terminal whether it speaks it and turns it on where it
  does: Ghostty, kitty, WezTerm, and iTerm2 with it enabled. On Windows and on a terminal
  without it — Apple's Terminal, Windows Terminal — `Ctrl+C` is the key, which is what it is
  in every other application there anyway. `Ctrl+C` keeps working everywhere, and still leaves
  the room when nothing is selected. Pasting needed nothing: `Cmd+V` and `Ctrl+V` are the
  terminal's own and always were.
  - The protocol also changes how `Esc` and `Ctrl+key` are encoded, so the client translates
    them back rather than letting Bubble Tea see sequences it does not know. Set
    `OPENMEET_NO_KITTY=1` to turn the whole thing off.
- The clipboard is reached two ways at once: the platform's own tool when the session is
  local, and OSC 52 through the terminal always, which is what carries a copy home from a
  client running over SSH. A line over the composer says it happened, and says when it was the
  terminal that carried it — that route is one an emulator can be set to refuse, and Apple's
  Terminal ignores it outright (there `pbcopy` does the work).
- A line of transient feedback over the composer for the things whose only other sign was a
  chip changing its label: a share starting or stopping, a share that ended on its own and
  why, a camera that would not open, a change of audio device, a copy.

- The composer is a text field rather than a place text arrives. Click anywhere in the draft
  and the caret goes there; drag to select, double click for a word; Backspace or Delete
  removes a selection, and typing or pasting over one replaces it. `Ctrl+W` deletes the word
  behind the caret, `Ctrl+U` deletes back to the start — which is what Ghostty already sends
  for `Cmd+Backspace`, so that works too — `Ctrl+A` selects the whole draft, `Shift+←/→`
  extend a selection, and `Option+←/→` move by a word (a terminal sends those as `Alt+B` and
  `Alt+F`). `Ctrl+Backspace` means the same as `Ctrl+W`, where the terminal can send it at
  all: measured, `Option+Backspace` in Ghostty is indistinguishable from Backspace, so it
  cannot be given a meaning of its own.

### Fixed

- Pasting into the composer no longer wrecks the screen. A paste arrives as one key event with
  the clipboard's every character in it, newlines included, and a newline went into a cell and
  then into the frame itself — which pushed every row after it sideways and left the room
  unreadable until it was restarted. Control characters are now stripped where text enters
  (newlines and tabs become spaces, so a pasted paragraph is one message) and again at the
  canvas, which will not hold one whoever hands it over. That second half matters beyond
  pasting: a chat message from another client is data, and until now one containing a newline
  would have redrawn your screen wrong.
- Copying works on Windows. A selection there was silently thrown away the instant you reached
  for `Ctrl+C` — in the conversation *and* in the composer — so the key found nothing to copy
  and left the room instead, which made copying impossible on that platform. Windows sends a
  key event carrying a NUL for the Ctrl key itself ahead of every ctrl chord, and it was being
  taken for a keypress: in the composer it replaced the selection, as typing over one should,
  and in the conversation it put the selection away, as any key should. It is not a keypress,
  and now nothing sees it.
- The composer wraps instead of running off the edge. Typing past the width of the chat pane
  used to push what you were writing out of sight, with no scroll and no second line; the
  input now grows upward as the draft wraps — up to six rows, or a third of the pane, and past
  that it scrolls to keep the cursor in view and marks the rows above with `…`. The log gives
  up the rows it takes and gets them back when the message is sent.

### Changed

- **New `settings.json` keys: `mouse` and `copyOnSelect`**, both `"on"` or `"off"`, both with a
  row under Advanced. `mouse` is on by default and absent reads as on, so nothing needs doing.
  Turn it off to hand click, drag and wheel back to the terminal along with its own selection;
  it takes effect on the spot. For one drag without turning anything off, hold the key your terminal uses to
  override an application's mouse — Shift in Ghostty, Windows Terminal and most others,
  Option in iTerm2, Fn in Terminal.app — which the setting's own line of help names for the
  terminal you are actually in.
- `copyOnSelect` is **off** by default and absent reads as off: letting go of a drag leaves the
  selection up and does not touch the clipboard, because a stray drag should not overwrite what
  you were carrying. `Ctrl+C` is what copies. Turn it on under Advanced for the other
  behaviour, where releasing the button is enough.

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

[Unreleased]: https://github.com/manuelvegadev/openmeet/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/manuelvegadev/openmeet/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/manuelvegadev/openmeet/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/manuelvegadev/openmeet/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/manuelvegadev/openmeet/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/manuelvegadev/openmeet/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/manuelvegadev/openmeet/compare/terminal-v0.5.2...v0.6.0
