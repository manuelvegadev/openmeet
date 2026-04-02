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
- **Cross-platform** — works on macOS and Linux

## Prerequisites

- **Node.js 22+** — [download](https://nodejs.org)
- **sox** — audio capture and playback engine
- **ffmpeg** _(optional)_ — required for video and screen sharing

Install dependencies:

```bash
# macOS
brew install sox ffmpeg

# Ubuntu / Debian
sudo apt install sox ffmpeg

# Fedora
sudo dnf install sox ffmpeg

# Arch
sudo pacman -S sox ffmpeg
```

## Install

```bash
npm install -g openmeet-terminal
```

Or with the one-liner installer (checks prerequisites for you):

```bash
curl -fsSL https://raw.githubusercontent.com/manuvega/openmeet/main/packages/terminal/install.sh | bash
```

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
| `--no-video` | Disable video (audio-only mode) | |
| `--video-device <id>` | Video capture device (e.g., `"0"`) | |
| `--no-overlay` | Disable video overlay | |
| `--test-camera` | Test camera capture (opens ffplay preview) | |
| `--test-screen` | Test screen capture (lists screens, opens ffplay preview) | |
| `--debug` | Enable debug logging (writes to `~/.config/openmeet/debug.log`) | |
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
Terminal ──sox rec──▶ WebRTC Audio ──▶ Remote Peers
Terminal ──ffmpeg──▶ WebRTC Video ──▶ Remote Peers (webcam + screen)
                                            │
Remote Peers ──▶ WebRTC Audio ──sox play──▶ Terminal
Remote Peers ──▶ WebRTC Video ──ffplay────▶ Terminal (separate windows)
                                            │
Terminal ◀────────── WebSocket ──────────▶ Server
                   (signaling + chat)
```

1. **Audio capture**: `sox rec` records from your mic at 48kHz/16-bit stereo and feeds 10ms PCM frames into a WebRTC audio track (256kbps Opus)
2. **Audio playback**: incoming WebRTC audio is piped to `sox play` via FIFOs for each remote peer, with per-peer volume control
3. **Video capture**: `ffmpeg` captures webcam (1080p) or screen (1080p@30fps) and feeds raw I420 frames into WebRTC video tracks
4. **Video display**: `ffplay` opens separate windows for remote webcam and screen share streams, with aspect-ratio-preserving letterboxing
5. **Signaling**: WebSocket connection to the OpenMeet server handles SDP/ICE exchange, chat messages, and room state
6. **WebRTC**: peer-to-peer connections using `@roamhq/wrtc` (native WebRTC bindings for Node.js) with 3 transceivers per connection (audio, webcam, screen)

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

Install sox using your package manager (see [Prerequisites](#prerequisites)).

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
