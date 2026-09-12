# openmeet-terminal

> **Retired, September 2026.** OpenMeet is now a single 12 MB binary for macOS and Windows,
> written in Go, installed with one line and kept current by itself — see
> [openmeet.manuelvega.dev](https://openmeet.manuelvega.dev) or the
> [project README](https://github.com/manuelvegadev/openmeet#install). No further versions of
> this npm package will be published. What follows describes the last one, 0.5.2, which still
> works against the same server (audio and chat with Go peers; video only with other Node
> peers, since it has no H.264).

No browser needed. Just your terminal, a mic, and speakers.

![OpenMeet running in a terminal: the conversation on the left, the participants with their state tags and speaking dots on the right](https://raw.githubusercontent.com/manuelvegadev/openmeet/main/docs/screenshot.png)

## What it was

A terminal client built on Ink (React for terminals), `@roamhq/wrtc` and audify: two
processes — the interface, and an engine holding WebRTC and the audio devices — talking over
IPC. It did audio, chat, webcam and screen sharing on macOS, Windows and Linux, and
everything the app does today it did first.

## Why it is still in the repository

Not as a product. As the thing the Go client was drawn from:

- Its screens are the Go client's reference frames. `packages/go/internal/tui/testdata` holds
  captures of this client at 120x34, and a test compares every screen against them cell for
  cell, so the interface cannot drift from the one people learnt.
- Its `src/lib` holds working versions of things the Go client ported or still owes: the
  voice gate and its test, the polyphase resampler, the input channel policy, the NVIDIA
  Broadcast name matching, the chat panel's scrolling tests.
- Its scripts are how several bugs were found, and the method is worth keeping: the audio
  cost decomposition, the A/V bench, the SDP probes, the palette contrast check.

## If you are looking for the app

[openmeet.manuelvega.dev](https://openmeet.manuelvega.dev), or the
[project README](https://github.com/manuelvegadev/openmeet#install). One binary, one line to
install, and it keeps itself current.
