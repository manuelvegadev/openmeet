# WebSocket + WebRTC Architecture

This document explains how OpenMeet uses WebSocket signaling and WebRTC peer connections to deliver real-time audio, webcam and screen sharing between terminal clients.

## High-Level Architecture

```
Client A <──── WebRTC P2P (media) ────> Client B
   ↑                                       ↑
   │         WebSocket (signaling)         │
   └──────────> Server <───────────────────┘
```

- **WebSocket** carries signaling messages (SDP offers/answers, ICE candidates) and application-level messages (chat, mute state, screen share state).
- **WebRTC** carries the actual media (audio, webcam video, screen video) directly between peers — the server never touches media data.
- **Topology**: Full mesh — every client maintains a direct WebRTC connection to every other client. Capped at 6 participants.

## WebSocket Layer

### Client (`packages/terminal/src/lib/websocket.ts`)

`WebSocketClient` wraps a single `ws` connection.

**Key features:**
- **Auto-reconnect**: Exponential backoff, max 10 attempts.
- **Pub/sub**: `subscribe(handler)` and `onConnectionChange(handler)` return unsubscribe functions.
- **Disposed flag**: When `disconnect()` is called, `disposed = true` suppresses `close`/`error` handlers to prevent spurious reconnect attempts during intentional teardown.

### Server (`packages/server/src/signaling.ts`)

The WebSocket server at `/ws` handles message routing:

| Message Type | Routing |
|---|---|
| `join-room` | Server processes (adds to room), responds with `room-joined`, broadcasts `participant-joined` |
| `offer`, `answer`, `ice-candidate` | Forwarded to target peer by `toId` (1:1) |
| `mute-state`, `screen-share-state` | Broadcast to all room members except sender |
| `chat-message` | Broadcast as `chat-broadcast` to all room members |

The server also pings all clients every 25 seconds to keep connections alive through reverse proxies.

### Message Types (`packages/shared/src/types.ts`)

All messages are a discriminated union (`WSMessage`) keyed by `type`. Key message interfaces:

| Type | Direction | Purpose |
|---|---|---|
| `join-room` | Client → Server | Join a room with a username |
| `room-joined` | Server → Client | Confirmation with `yourId` + existing participants |
| `participant-joined` | Server → Clients | New peer notification |
| `participant-left` | Server → Clients | Peer disconnected |
| `offer` | Client → Client (via server) | SDP offer for WebRTC connection |
| `answer` | Client → Client (via server) | SDP answer for WebRTC connection |
| `ice-candidate` | Client → Client (via server) | ICE candidate for NAT traversal |
| `mute-state` | Client → Clients (broadcast) | Audio/video mute state (`isAudioMuted`, `isVideoMuted`) |
| `screen-share-state` | Client → Clients (broadcast) | Screen sharing on/off (`isScreenSharing`) |
| `chat-message` | Client → Server | Chat text message |
| `chat-broadcast` | Server → Clients | Delivered chat message |

## WebRTC Layer

### Connection Lifecycle

```
Newcomer (A) joins room with existing participant (B):

1. Server sends room-joined to A (includes B in participants list)
2. A creates PeerConnection for B (3 transceivers: audio, webcam, screen)
3. A creates SDP offer → sends via WebSocket to B
4. B receives offer → creates PeerConnection → sets remote description → creates answer
5. B sends SDP answer via WebSocket to A
6. A sets remote description
7. Both exchange ICE candidates via WebSocket
8. Direct P2P media flows between A and B
```

When B joins a room with multiple existing participants (A, C, D), B creates an offer to each. Existing participants do NOT create offers — they wait for the newcomer's offer.

### 3-Transceiver Architecture

Every peer connection creates exactly 3 transceivers in a fixed order:

| Index | Kind | Purpose | Initial Direction |
|---|---|---|---|
| 0 | audio | Microphone | `sendrecv` (even without track, to ensure `ontrack` fires) |
| 1 | video | Webcam | `sendrecv` (even without track, for late camera arrival) |
| 2 | video | Screen share | `recvonly` (upgraded to `sendrecv` when sharing) |

This fixed ordering is critical — both sides create transceivers in the same order so that after SDP exchange, `getTransceivers()` returns them in m-line order.

### PeerConnectionManager (`packages/terminal/src/lib/webrtc.ts`)

Manages all peer connections with `@roamhq/wrtc`.

| Method | Purpose |
|---|---|
| `createConnection(peerId)` | Offerer path: create PC with 3 transceivers, create offer, send via signaling |
| `handleOffer(peerId, sdp)` | Answerer path: create PC via `addTrack`, set remote desc, force `sendrecv` directions, create answer |
| `handleAnswer(peerId, sdp)` | Set remote description from answer |
| `handleIceCandidate(peerId, candidate)` | Add ICE candidate |
| `setVideoTrack(track)` | Attach webcam to transceiver 1 |
| `setScreenTrack(track)` | Attach screen to transceiver 2, toggle direction, renegotiate |
| `removeConnection(peerId)` | Close PC, cancel retries |

**Answerer path detail:** only `addTrack`-created transceivers are eligible for m-line matching during `setRemoteDescription`, so the answerer pre-attaches audio with `addTrack` and lets `setRemoteDescription` create the two video transceivers. Those default to `recvonly`, so directions are explicitly set to `sendrecv` before `createAnswer()`.

### Track Routing (ontrack handler)

Incoming tracks are routed by arrival order: the audio track goes to the peer's audio sink, the first video track is the webcam, and the second video track is the screen share. Tracks are stored in refs and attached to `VideoManager` (ffplay windows) on demand when the user presses `w` or `e`.

### Screen Share Flow

```
User A starts screen sharing:

1. ffmpeg captures the screen → RTCVideoSource track
2. setScreenTrack(track) on PeerConnectionManager:
   - replaceTrack(screenTrack) on transceiver 2's sender
   - Change transceiver 2 direction: recvonly → sendrecv
   - Renegotiate (new offer/answer exchange, SDP munged to force a=sendrecv on the screen m-line)
3. Broadcast screen-share-state { isScreenSharing: true } via WebSocket

User B receives:
4. WebSocket message: screen-share-state → marks A as sharing
5. WebRTC renegotiation → ontrack fires for screen video
6. Pressing `e` on A opens an ffplay window with the screen track

User A stops screen sharing:
7. replaceTrack(null) on transceiver 2's sender
8. Change transceiver 2 direction: sendrecv → recvonly
9. Renegotiate
10. Broadcast screen-share-state { isScreenSharing: false }

User B receives:
11. WebSocket message: screen-share-state → closes A's screen window
```

### Glare Handling (perfect negotiation)

If both peers send offers simultaneously, the peer with the lexicographically smaller ID is *polite* and yields; the other is *impolite* and ignores the incoming offer. `@roamhq/wrtc` does not support `setLocalDescription({ type: 'rollback' })`, so the polite peer closes its connection and recreates it as the answerer.

### Connection Retry

Failed connections are retried with exponential backoff (1s, 2s, 4s, max 3 attempts). Only the impolite peer retries, avoiding simultaneous retry storms.

### SDP Modification

`boostOpusQuality()` (`packages/terminal/src/lib/sdp.ts`) patches Opus `fmtp` lines to enable stereo at 256kbps:

```
a=fmtp:111 minptime=10;useinbandfec=1
→ a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000
```

### Renegotiation

Renegotiation (new offer/answer exchange on an existing connection) is triggered by screen share start/stop (transceiver 2 direction change). The `makingOffer` set prevents concurrent renegotiations with the same peer.

## Room Orchestration (`packages/terminal/src/engine/room-engine.ts`)

`RoomEngine` runs in a separate engine process (forked by the TUI, see `engine/client.ts`) and wires `WebSocketClient`, `PeerConnectionManager`, `AudioManager` and `VideoManager` together. It reports to the TUI over IPC as coalesced `RoomState` snapshots plus chat and room events; `hooks/use-room.ts` mirrors them into React state:

- `participants` — room membership
- `remoteMuteStates`, `remoteVideoMuteStates`, `remoteScreenShareStates` — per-peer media state from WebSocket broadcasts
- `messages` — chat history
- `stats` — bitrate, RTT, packet loss and per-peer latency estimates from the WebRTC stats loop

## Mute/Video State Broadcasting

Media state is broadcast via WebSocket (not WebRTC) for reliability:

```typescript
// Broadcast triggers: audio/video toggle, join, participant count change
send({
  type: 'mute-state',
  fromId: myId,
  isAudioMuted,
  isVideoMuted,
});
```

Re-broadcasting on `participants.length` change ensures newcomers immediately learn the mute/video and screen share state of all existing participants.

## Connection Resilience

| Mechanism | Implementation |
|---|---|
| WebSocket reconnect | Exponential backoff, max 10 attempts |
| Re-join on reconnect | `connected` state change triggers `join-room` |
| State re-broadcast | Mute/screen-share state re-sent when participants change |
| Server keepalive | WebSocket ping every 25s |
| Connection failure | `onconnectionstatechange` → retry with backoff (impolite peer only), then remove |
| Disposed flag | Prevents reconnect storms during intentional teardown |
