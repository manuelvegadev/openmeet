# openmeet-terminal

A terminal-based client for [OpenMeet](https://openmeet.mvega.pro) — join video conferencing rooms right from your terminal with real-time audio chat and text messaging over WebRTC.

No browser needed. Just your terminal, a mic, and speakers.

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ OpenMeet | Room: 123 | 3p                                                            ↑66k ↓27k | RTT:0ms Loss:0% | ● │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ Participants:                                                                                                        │
│  ○ 🥝 (you)                                                                                     ░░░░░░░░░░░░░░░░░░░░ │
│  ○ > 🥸 [muted]                                                                        vol:100% ░░░░░░░░░░░░░░░░░░░░ │
│  ○   👽                                                                                vol:100% ░░░░░░░░░░░░░░░░░░░░ │
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
│ [Esc] Leave [Tab] Chat [m] mute [d] Devices [↑↓] Select [[-]/[+]] Vol                                    ● Connected │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Features

- **Real-time audio chat** — full-duplex audio via WebRTC with 128kbps Opus encoding
- **Text messaging** — send and receive chat messages alongside audio
- **Device selection** — pick your mic and speakers, with a built-in audio test step
- **Per-participant volume** — adjust volume for each remote peer independently
- **Speaking indicators** — see who's talking with live VU meters
- **Connection stats** — real-time bitrate, RTT, and packet loss display
- **Room management** — create new rooms or join existing ones by room code
- **Emoji identities** — auto-assigned persistent emoji username (e.g., 🐶, 🦊, 🐸)
- **Cross-platform** — works on macOS and Linux

## Prerequisites

- **Node.js 22+** — [download](https://nodejs.org)
- **sox** — audio capture and playback engine

Install sox:

```bash
# macOS
brew install sox

# Ubuntu / Debian
sudo apt install sox

# Fedora
sudo dnf install sox

# Arch
sudo pacman -S sox
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
| `-h, --help` | Show help | |

### Keyboard shortcuts

Once inside a room:

| Key | Action |
|-----|--------|
| `Tab` | Toggle focus between participant list and chat input |
| `m` | Toggle mute (when participant list is focused) |
| `d` | Open device picker |
| `Up` / `Down` | Select participant |
| `[` / `]` or `-` / `+` | Adjust selected peer's volume |
| `Enter` | Send chat message (when chat input is focused) |
| `Esc` | Leave room |

## How it works

```
Terminal ──sox rec──▶ WebRTC Audio ──▶ Remote Peers
                                            │
Remote Peers ──▶ WebRTC Audio ──sox play──▶ Terminal
                                            │
Terminal ◀────────── WebSocket ──────────▶ Server
                   (signaling + chat)
```

1. **Audio capture**: `sox rec` records from your mic at 48kHz/16-bit mono and feeds 10ms PCM frames into a WebRTC audio track
2. **Audio playback**: incoming WebRTC audio is piped to `sox play` for each remote peer, with per-peer volume control
3. **Signaling**: WebSocket connection to the OpenMeet server handles SDP/ICE exchange, chat messages, and room state
4. **WebRTC**: peer-to-peer connections using `@roamhq/wrtc` (native WebRTC bindings for Node.js)

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

### No audio from remote peers

Make sure your output device is set correctly. Press `d` inside a room to open the device picker, select your output device, and test it with the built-in test tone.

### Connection issues behind NAT/firewall

OpenMeet uses Google STUN servers for NAT traversal. If you're behind a restrictive firewall or symmetric NAT, peer-to-peer connections may fail. A TURN server is not currently included.

## License

MIT
