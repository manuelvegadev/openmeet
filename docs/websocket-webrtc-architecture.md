# Signaling and WebRTC

How a room works: what the server does, what it never sees, and the contract both sides of a
connection have to honour. The client is `packages/go`; the server is `packages/server`.

```
Client A <──── WebRTC P2P (media) ────> Client B
   ↑                                       ↑
   │         WebSocket (signaling)         │
   └──────────> Server <───────────────────┘
```

- **WebSocket** carries the handshake (SDP, ICE) and the room's own messages: chat, mute
  state, screen-share state.
- **WebRTC** carries the media, directly between peers. **The server never sees a byte of
  it**, and that is a constraint on every future change, not an implementation detail.
- **Topology**: a full mesh, every client connected to every other, capped at 6 people.

## The WebSocket layer

`internal/signal` is one connection (`coder/websocket`), a `Send`, and an `Incoming`
channel. Reconnection lives a layer up, in `internal/engine`: on a drop it backs off from
1 s to 30 s and rejoins as a newcomer, because the peers it had are gone with the link.

The server (`packages/server/src/signaling.ts`) routes:

| Message | Routing |
|---|---|
| `join-room` | adds to the room, answers `room-joined` (with `yourId` and who is already there), tells the others `participant-joined` |
| `offer`, `answer`, `ice-candidate` | forwarded to `toId`, one to one |
| `mute-state`, `screen-share-state` | broadcast to the rest of the room |
| `chat-message` | broadcast as `chat-broadcast` |

It pings every client every 25 s so reverse proxies do not time the connection out, keeps
rooms in memory, and forgets a room when the last person leaves. The shapes are one
discriminated union in `packages/shared/src/types.ts`, which the Go client mirrors field for
field in `internal/signal`.

## The WebRTC layer

`internal/rtc` holds one `PeerConnection` per peer and, across all of them, **three tracks**:

| track | what |
|---|---|
| audio | `TrackLocalStaticRTP`, Opus, payload type 111 (`minptime=10;useinbandfec=1`) |
| webcam | H.264, payload type 102 (`42e01f`, packetization-mode 1) |
| screen | H.264, the same |

Three tracks, not three per peer: **the microphone is encoded once and the same RTP packet
is written to every connection**, and a screen share is captured, encoded and packetised
once for the whole room. That is the difference that keeps the client's CPU flat as the room
grows ([performance.md](performance.md)), and it is why the codec is chosen by what the
machine's hardware encoder produces rather than by what a browser would prefer.

### The connection contract

Both sides must end up with the same three transceivers in the same order — audio, webcam,
screen — or the m-lines do not line up:

1. The **newcomer** offers. It creates three `sendrecv` transceivers from the tracks above,
   in that order, and sends the offer.
2. The **answerer** binds the same three tracks before answering, so `setRemoteDescription`
   matches them in the same order.
3. Audio is `sendrecv` even while muted, so the remote `OnTrack` fires and a peer's state is
   known before they say anything.

### Glare, retries and state

- **Glare**: two offers crossing are resolved by comparing ids — `polite = myID < peerID`.
  The polite peer yields and answers; the impolite one ignores the incoming offer.
- **Retries**: a failed connection is rebuilt with backoff, by the impolite peer only, so
  both ends do not retry into each other.
- **Screen share state** is a WebSocket broadcast, not an SDP change: a share starting or
  stopping does not renegotiate anything, it flips a flag everyone already has a track for.
  It is re-broadcast when the participant count changes, so a newcomer learns who is already
  sharing. When it goes false, watchers close that peer's window.
- **Mute state** carries the microphone and the camera (`isAudioMuted`, `camOn`); a muted
  microphone stops at the gate, so a muted participant costs every peer nothing at all.

### Playout

pion delivers packets and stops there — there is no jitter buffer, no concealment, no clock
correction in the library. `internal/audio/playout.go` is ours: per peer, an RTP reorder
buffer whose depth follows the measured RFC 3550 jitter (two frames to six), Opus decode,
a lost packet rebuilt from the **in-band FEC** of the packet after it where that has arrived
and concealed by PLC where it has not, and a catch-up that skips frames nobody can hear when
a sender's clock runs ahead of ours. Then one mixer across peers, into the playback ring.

Video takes the same shape with pion's `samplebuilder`: 400 packets or 200 ms of slack, so a
NACK retransmission has time to land before a frame is given up on.

## What the network sees

Every UDP socket the client opens is marked as voice — DSCP EF, and on macOS the socket's
service class too, which is what puts the packets in Wi-Fi's voice access category ahead of
a browser's downloads. A router that honours it does the same; one that does not ignores the
mark. Windows ignores `IP_TOS` without a machine-wide policy; doing it there needs the qWAVE
API, which is in [backlog.md](backlog.md).
