# WebSocket + WebRTC Architecture

This document explains how OpenMeet uses WebSocket signaling and WebRTC peer connections to deliver real-time video conferencing with simultaneous webcam and screen sharing.

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

### Client (`packages/client/src/lib/websocket.ts`)

`WebSocketClient` is a standalone class (no React dependency) that manages a single WebSocket connection.

**Key features:**
- **Auto-reconnect**: Exponential backoff (1s, 2s, 4s, ... up to 10s), max 10 attempts.
- **Pub/sub**: `subscribe(handler)` and `onConnectionChange(handler)` return unsubscribe functions.
- **Disposed flag**: When `disconnect()` is called, `disposed = true` suppresses `onclose`/`onerror` handlers to prevent spurious reconnect attempts during intentional teardown (important for React Strict Mode).

### React Hook (`packages/client/src/hooks/use-websocket.ts`)

`useWebSocket(onMessage)` creates a `WebSocketClient` on mount, subscribes to messages, and cleans up on unmount. Returns `{ send, connected }`.

The `onMessage` callback is stored in a ref to avoid effect re-runs when the handler identity changes.

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
| `chat-message` | Client → Server | Chat text/file message |
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

### PeerConnectionManager (`packages/client/src/lib/webrtc.ts`)

Manages all peer connections and track routing.

**Key methods:**

| Method | Purpose |
|---|---|
| `createConnection(peerId)` | Offerer path: create PC, create offer, send via signaling |
| `handleOffer(peerId, sdp)` | Answerer path: create/get PC, set remote desc, create answer |
| `handleAnswer(peerId, sdp)` | Set remote description from answer |
| `handleIceCandidate(peerId, candidate)` | Add ICE candidate |
| `setLocalStream(stream)` | Attach webcam/mic to existing connections (transceivers 0+1) |
| `setScreenStream(stream)` | Attach screen to transceiver 2, toggle direction, renegotiate |
| `removeConnection(peerId)` | Close PC, clean up streams |

### Track Routing (ontrack handler)

The `ontrack` handler routes incoming tracks to the correct stream using **arrival order** rather than transceiver identification:

```
ontrack fires for video track
  → Does the remote webcam stream already have a video track?
    → YES: This must be the screen share track → handleScreenTrack()
    → NO:  This is the first (webcam) video track → add to webcam stream
ontrack fires for audio track
  → Always goes to the webcam stream
```

This approach avoids comparing transceiver references or mids, which can fail during renegotiation when browsers return different wrapper objects. The `ontrack` event is guaranteed to fire in m-line order (audio → webcam video → screen video), so the first video track is always the webcam.

### Screen Share Flow

```
User A starts screen sharing:

1. getDisplayMedia() → screenStream
2. setScreenStream(screenStream) on PeerConnectionManager:
   - replaceTrack(screenTrack) on transceiver 2's sender
   - Change transceiver 2 direction: recvonly → sendrecv
   - Renegotiate (new offer/answer exchange)
3. Broadcast screen-share-state { isScreenSharing: true } via WebSocket

User B receives:
4. WebSocket message: screen-share-state → sets remoteScreenShareStates[A] = true
5. WebRTC renegotiation → ontrack fires for screen video (or onunmute fallback)
6. Track routed to screen stream → VideoGrid shows separate screen tile

User A stops screen sharing:
7. replaceTrack(null) on transceiver 2's sender
8. Change transceiver 2 direction: sendrecv → recvonly
9. Renegotiate
10. Broadcast screen-share-state { isScreenSharing: false }

User B receives:
11. WebSocket message: screen-share-state → immediately sets screenStream to null
    (prevents showing last decoded frame)
```

### Screen Track `onunmute` Fallback

During renegotiation, `ontrack` may not fire for the screen transceiver when its direction changes from `inactive` to `sendrecv` (the receiver track already exists, it just becomes unmuted). To handle this:

```typescript
// Set up during createPeerConnection, after creating transceiver 2:
const screenReceiverTrack = getScreenTransceiver(pc)?.receiver?.track;
screenReceiverTrack.onunmute = () => {
  this.handleScreenTrack(peerId, screenReceiverTrack);
};
```

The `unmute` event on the receiver track fires reliably when the remote side starts sending, regardless of whether `ontrack` fires.

### Glare Handling

If both peers send offers simultaneously (both in `have-local-offer` state), the receiver rolls back its own offer before processing the remote one:

```typescript
if (pc.signalingState === 'have-local-offer') {
  await pc.setLocalDescription({ type: 'rollback' });
}
await pc.setRemoteDescription(sdp);
```

### SDP Modification

`enableStereoOpus()` patches the SDP to enable stereo audio:

```
a=fmtp:111 minptime=10;useinbandfec=1
→ a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1
```

### Renegotiation

Renegotiation (new offer/answer exchange on an existing connection) is triggered by:
- **Screen share start/stop**: Transceiver 2 direction changes
- **Late camera arrival**: Transceiver direction upgrade from `recvonly` to `sendrecv`
- **New track added**: When `replaceTrack` isn't sufficient

The `makingOffer` set prevents concurrent renegotiations with the same peer.

## React Integration (`packages/client/src/hooks/use-webrtc.ts`)

`useWebRTC(send, localStream, screenStream)` wraps `PeerConnectionManager` with React state:

**State managed:**
- `remoteStreams: RemoteStream[]` — per-peer webcam + screen streams
- `participants: Participant[]` — room membership
- `screenShareStates: Record<string, boolean>` — who is screen sharing

**Key behavior:**
- `handleSignalingMessage` dispatches WebSocket messages to the manager
- `screen-share-state: false` immediately clears `screenStream` to `null` (prevents last-frame persistence)
- Local stream/screen stream changes are forwarded to the manager via effects

### RemoteStream Interface

```typescript
interface RemoteStream {
  peerId: string;
  username: string;
  webcamStream: MediaStream;      // Audio + webcam video
  screenStream: MediaStream | null; // Screen video (null when not sharing)
}
```

## Mute/Video State Broadcasting

Media state is broadcast via WebSocket (not WebRTC) for reliability:

```typescript
// Broadcast triggers: audio/video toggle, join, participant count change
send({
  type: 'mute-state',
  fromId: myId,
  isAudioMuted: !media.isAudioEnabled,
  isVideoMuted: !media.isVideoEnabled,
});
```

Re-broadcasting on `participants.length` change ensures newcomers immediately learn the mute/video state of all existing participants.

## Connection Resilience

| Mechanism | Implementation |
|---|---|
| WebSocket reconnect | Exponential backoff, max 10 attempts |
| Re-join on reconnect | `connected` state change triggers `join-room` |
| State re-broadcast | Mute/screen-share state re-sent when participants change |
| Server keepalive | WebSocket ping every 25s |
| Connection failure | `onconnectionstatechange` → remove failed peer connection |
| Disposed flag | Prevents reconnect storms during intentional teardown |

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Room Page                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │useWebSocket│  │useWebRTC │  │ useMedia │  │  useState   │ │
│  │  send()   │  │ manager  │  │ stream   │  │ muteStates │  │
│  │  connected│  │ remotes  │  │ screen   │  │ videoMutes │  │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬─────┘  │
│        │             │             │               │         │
│        ▼             ▼             ▼               ▼         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    VideoGrid                          │   │
│  │  localWebcam + localScreen + remoteStreams[]          │   │
│  │  + remoteMuteStates + remoteVideoMuteStates          │   │
│  │  + remoteScreenShareStates                           │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

WebSocket Messages:                WebRTC Media:
  join-room ──────►                  Audio ◄──────►
  room-joined ◄────                  Webcam ◄─────►
  offer/answer ◄──►                  Screen ◄─────►
  ice-candidate ◄─►
  mute-state ──────►
  screen-share-state►
  chat-message ────►
```
