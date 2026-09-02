# openmeet-terminal

A terminal-based client for [OpenMeet](https://openmeet.mvega.pro) — join video conferencing rooms right from your terminal with real-time audio chat and text messaging over WebRTC.

No browser needed. Just your terminal, a mic, and speakers.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ OpenMeet v0.1.2 | Room: 123 | 3p                                                            ↑66k ↓27k | RTT:0ms Loss:0% | ● │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ Participants:                                                                                                        │
│  ○ 🥝 (you)                                                                                     ░░░░░░░░░░░░░░░░░░░░ │
│  ○ > 🥸 [muted]                                                                vol:100% ↓64k ~45ms ░░░░░░░░░░░░░░░░░░░░ │
│  ○   👽                                                                        vol:100% ↓32k ~38ms ░░░░░░░░░░░░░░░░░░░░ │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│                                                           │ Room Log                                    in room: 13s │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │                                                          │
│                                                           │ [23:52:14] · You joined the room                         │
│                                                           │ [23:52:14] · 🥸 is in the room                           │
│ [23:52] 🥝: Hi!                                           │ [23:52:14] · 👽 is in the room                           │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ > Type message...                                                                                                    │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ [Esc] Leave [Tab] Chat [m] mute [s] share [w] watch [e] screen [↑↓] Select [[-]/[+]] Vol                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Features

- **Real-time audio chat** — full-duplex stereo audio via WebRTC with 256kbps Opus encoding
- **Video support** — send and receive webcam video (1080p) via ffmpeg/ffplay
- **Screen sharing** — share your screen at 1080p@30fps, view remote screen shares
- **Text messaging** — send and receive chat messages alongside audio
- **Device selection** — pick your mic, speakers, camera, and screen capture device
- **Per-participant volume** — adjust volume for each remote peer independently
- **Speaking indicators** — see who's talking with live VU meters
- **Connection stats** — real-time bitrate, RTT, packet loss, and estimated per-peer latency display
- **Connection recovery** — automatic retry with exponential backoff on connection failure
- **Room management** — create new rooms or join existing ones by room code
- **Emoji identities** — auto-assigned persistent emoji username (e.g., 🐶, 🦊, 🐸)
- **Debug logging** — optional file-based debug log at `~/.config/openmeet/debug.log`
- **Cross-platform** — macOS and Windows (audio + chat), Linux (best effort)

## Platform support

One package, one version number, for every platform. What that version can do depends on the OS:

| Platform | Status | Features |
|----------|--------|----------|
| macOS | Supported | Audio, chat, webcam, screen sharing |
| Windows 10/11 (x64) | Supported | Audio, chat. Video not available yet |
| Linux | Best effort | Audio, chat, webcam, screen sharing (X11 + PulseAudio); not actively tested |

The app shows the platform and its feature set next to the version on the home screen. Version 1.0 will mean feature parity between macOS and Windows.

## Prerequisites

- **Node.js 22+** — [download](https://nodejs.org)
- **ffmpeg** _(optional, macOS/Linux)_ — required for video and screen sharing
- **sox** _(optional)_ — only for `--audio-backend sox` (the default on Linux)

Audio I/O talks to CoreAudio (macOS) and WASAPI (Windows) directly through a bundled native
module, so nothing else is needed for audio. On Windows nothing besides Node.js is required;
video is not available there yet.

Optional dependencies:

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Fedora
sudo dnf install ffmpeg

# Arch
sudo pacman -S ffmpeg
```

## Install

```bash
npm install -g openmeet-terminal
```

Or with the one-liner installer (checks prerequisites for you):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/manuvega/openmeet/main/packages/terminal/install.sh | bash
```

```powershell
# Windows (PowerShell) — installs Node.js LTS via winget if missing
irm https://raw.githubusercontent.com/manuvega/openmeet/main/packages/terminal/install.ps1 | iex
```

On Windows use [Windows Terminal](https://aka.ms/terminal) (the default on Windows 11); the legacy console host is not supported. The installer registers an "OpenMeet" Windows Terminal profile and a desktop shortcut that opens the app in its own window (app icon and title, no scrollbar, closes on exit). Windows Terminal cannot hide its new-tab buttons or change the taskbar icon; a bundled terminal emulator would be the next step for a fully branded window.

## Usage

```bash
# Launch and create or join a room interactively
openmeet

# Join a specific room directly
openmeet --room abc123

# Connect to a self-hosted server
openmeet --server wss://your-server.com/ws

# Skip the device picker with explicit devices
openmeet --input-device "MacBook Pro Microphone" --output-device "MacBook Pro Speakers"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--server <url>` | WebSocket server URL | `wss://openmeet.mvega.pro/ws` |
| `--room <id>` | Room ID to join directly | _(interactive)_ |
| `--input-device <name>` | Audio input device name | _(device picker)_ |
| `--output-device <name>` | Audio output device name | _(device picker)_ |
| `--audio-backend <name>` | Audio I/O: `rtaudio` (native CoreAudio/WASAPI) or `sox` (fallback) | `rtaudio` on macOS/Windows, `sox` on Linux |
| `--input-channels <p>` | How the mic's channel pair is sent: `auto`, `stereo`, `mono`, `left`, `right` (saved) | `auto` |
| `--input-gain <dB>` | Capture gain in dB, -30 to 30 (saved) | `0` |
| `--pause-rendering <p>` | Pause TUI rendering (audio keeps running) when the window is `minimized`, when it is `unfocused`, or `never` (saved; also in Settings) | `minimized` |
| `--no-video` | Disable video (audio-only mode; always off on Windows) | |
| `--video-device <id>` | Video capture device (e.g., `"0"`) | |
| `--no-overlay` | Disable video overlay | |
| `--test-camera` | Test camera capture (opens ffplay preview) | |
| `--test-screen` | Test screen capture (lists screens, opens ffplay preview) | |
| `--debug` | Enable debug logging (writes to `~/.config/openmeet/debug.log`, `%APPDATA%\openmeet\debug.log` on Windows) | |
| `-h, --help` | Show help | |

### Keyboard shortcuts

Once inside a room:

| Key | Action |
|-----|--------|
| `Tab` | Toggle focus between participant list and chat input |
| `m` | Toggle mute (when participant list is focused) |
| `v` | Toggle camera on/off (requires `--video-device` or video enabled) |
| `s` | Toggle screen sharing (shows screen picker on first use) |
| `w` | Open/close selected peer's webcam (only when peer has camera on) |
| `e` | Open/close selected peer's screen share (only when peer is sharing) |
| `o` | Toggle video overlay (name, resolution info on video windows) |
| `d` | Open device picker |
| `Up` / `Down` | Select participant |
| `[` / `]` or `-` / `+` | Adjust selected peer's volume |
| `Enter` | Send chat message (when chat input is focused) |
| `Esc` | Leave room |

## How it works

```
Terminal ──mic (RtAudio)──▶ WebRTC Audio ──▶ Remote Peers
Terminal ──ffmpeg──▶ WebRTC Video ──▶ Remote Peers (webcam + screen)
                                            │
Remote Peers ──▶ WebRTC Audio ──mix──▶ speakers (RtAudio)
Remote Peers ──▶ WebRTC Video ──ffplay────▶ Terminal (separate windows)
                                            │
Terminal ◀────────── WebSocket ──────────▶ Server
                   (signaling + chat)
```

0. **Two processes**: the TUI forks an audio/network engine (`openmeet --engine`). Rendering the terminal never delays audio; the interface just paints the latest state it received.
1. **Audio capture**: the engine opens the microphone in-process (RtAudio → CoreAudio/WASAPI) at the device's own sample rate and channel count — 16 kHz Bluetooth headsets, 44.1 kHz USB mixers, 96 kHz interfaces, mono laptop mics all work — and converts to the pipeline's 48 kHz stereo with an in-process polyphase resampler (≈90 dB SNR), so the driver never resamples and your interface's clock setting is left alone. Interfaces with more than two inputs show one entry per channel pair. A channel policy (`auto` by default) notices a mono mic on one input of a stereo pair and sends it to both ears; `--input-gain` trims quiet or hot mics. The sound card clocks 10 ms frames straight into a WebRTC audio track (256kbps Opus). A capture-processor chain sits between the mic and WebRTC, where noise suppression will plug in.
2. **Audio playback**: each remote peer's decoded audio lands in a small playout buffer; the output callback mixes all peers (with per-peer volume) into one stereo stream. `--audio-backend sox` keeps the old `rec`/`play` subprocess pipeline on macOS/Linux.
3. **Video capture**: `ffmpeg` captures webcam (1080p) or screen (1080p@30fps) and feeds raw I420 frames into WebRTC video tracks
4. **Video display**: `ffplay` opens separate windows for remote webcam and screen share streams, with aspect-ratio-preserving letterboxing
5. **Signaling**: WebSocket connection to the OpenMeet server handles SDP/ICE exchange, chat messages, and room state
6. **WebRTC**: peer-to-peer connections using `@roamhq/wrtc` (native WebRTC bindings for Node.js) with 3 transceivers per connection (audio, webcam, screen)

## Pausing rendering in the background

The audio engine runs in its own process and never pauses. The TUI, however, redraws whenever a VU meter or a stat changes, which costs a few percent of a core during a conversation. With `--pause-rendering minimized` (the default) it stops applying updates while the terminal window is minimized and catches up the moment it is restored; `unfocused` does the same whenever the window loses focus (handy on a single screen, wrong if you keep the app visible on a second monitor); `never` disables it.

How "minimized" is detected: on Windows the app asks the OS about the Windows Terminal (or console) window hosting it; on macOS it asks Terminal.app or iTerm2 through Apple Events, which triggers the Automation permission prompt once — deny it and rendering is simply never paused. Other macOS terminals (WezTerm, kitty, Ghostty…) have no such hook; use `unfocused` there if you want the saving.

## Self-hosted server

If you're running your own [OpenMeet server](https://github.com/manuvega/openmeet), point the CLI at it:

```bash
openmeet --server wss://your-server.com/ws
```

For local development:

```bash
openmeet --server ws://localhost:3001/ws
```

## Troubleshooting

### "sox is required but not found"

Only shown with `--audio-backend sox` (the default on macOS/Linux). Either install sox with your package manager or run with `--audio-backend rtaudio` to use the native backend.

### No audio devices found (Windows)

Windows must expose at least one input or output endpoint (Settings > System > Sound). Inside a VM or over Remote Desktop, endpoints only exist while a session with audio redirection is connected. Check **Settings > Privacy & security > Microphone** allows desktop apps.

### "Microphone access denied" (macOS)

Your terminal app needs microphone permission:

1. Open **System Settings > Privacy & Security > Microphone**
2. Enable the toggle for your terminal app (Terminal, iTerm2, Warp, etc.)
3. Restart the terminal and try again

### Screen sharing doesn't work (macOS)

Screen capture requires Screen Recording permission and a compatible ffmpeg build:

1. Open **System Settings > Privacy & Security > Screen Recording**
2. Enable the toggle for your terminal app
3. Restart the terminal

On macOS 15 (Sequoia), ffmpeg must be built with ScreenCaptureKit support. If screen capture hangs, try `brew reinstall ffmpeg`. Test with `openmeet --test-screen`.

### No audio from remote peers

Make sure your output device is set correctly. Press `d` inside a room to open the device picker, select your output device, and test it with the built-in test tone.

### Connection issues behind NAT/firewall

OpenMeet uses Google STUN servers for NAT traversal. If you're behind a restrictive firewall or symmetric NAT, peer-to-peer connections may fail. A TURN server is not currently included.

## License

MIT
