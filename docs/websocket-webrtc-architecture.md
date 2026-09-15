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
  state, screen-share state, and the announcement that somebody has a file.
- **WebRTC** carries the media and the files, directly between peers. **The server never sees
  a byte of either**, and that is a constraint on every future change, not an implementation
  detail.
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
| `file-offer` | broadcast as `file-offer-broadcast`, to the sender as well — the description only, never the file |

It pings every client every 25 s so reverse proxies do not time the connection out, keeps
rooms in memory, and forgets a room when the last person leaves. The shapes are one
discriminated union in `packages/server/src/protocol.ts`, which the Go client mirrors field for
field in `internal/signal`.

## The WebRTC layer

`internal/rtc` holds one `PeerConnection` per peer and, across all of them, **three tracks**
and a data channel:

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
screen — followed by the data channel's `application` section, or the m-lines do not line up:

1. The **newcomer** offers. It creates three `sendrecv` transceivers from the tracks above,
   in that order, then the `control` data channel, and sends the offer. So every offer this
   client makes is audio 0, webcam 1, screen 2, control 3.
2. The **answerer** binds the same three tracks before answering, so `setRemoteDescription`
   matches them in the same order. It does **not** create a channel of its own: an answer's
   m-lines mirror the offer's, so one created there would never be negotiated, and one
   control channel per connection leaves no question about which to send on.
3. Audio is `sendrecv` even while muted, so the remote `OnTrack` fires and a peer's state is
   known before they say anything.

A peer whose binary predates the data channel offers no `application` section; nothing opens,
and the room works as it did minus the files.

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

### Files

A file is **announced** over the WebSocket and **fetched** over the connection — never
pushed. In a mesh a push is the same multiplication a screen share is, and almost all of it
would be waste, because most of the time nobody wants the file at all.

1. The sender reads the file's size and SHA-256, and broadcasts a `file-offer`. The server
   sets who it is from, the way it does for chat, and forwards the description to everyone —
   the sender included, so every row in the room is drawn by the same path.
2. A receiver who wants it sends `{"t":"get","id":…}` on the `control` channel.
3. The sender opens **a channel of its own for that transfer**, labelled `file:<id>`, and
   writes the file to it in 16 KiB messages. SCTP is already up, so the second channel costs
   no renegotiation — and it means a chunk is a chunk: no transfer id repeated on every
   message, no interleaving, and cancelling is closing the channel.
4. The receiver writes to `<name>.part`, checks the size and the digest, and only then
   renames. A transfer that fails leaves nothing that looks complete.

Flow control is the channel's own: the sender waits while `BufferedAmount` is over a
megabyte, so the disk is read at the speed of the wire and a file never passes through this
process's memory. On top of that there is a rate ceiling — 2000 kbps — because a transfer is
not the call and the uplink has to carry both. **On the local network there is none**: when
the nominated candidate pair is host-to-host with a private address (`rtc.LocalPair`), there
is no uplink to protect and a ceiling would be an invented limit.

Every part of this is on goroutines of its own. The 20 ms audio pump never waits on a
transfer, which is the same rule the video paths follow.

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
