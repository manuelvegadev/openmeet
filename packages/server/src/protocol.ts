// The WebSocket protocol: every message that crosses the wire, as a discriminated union.
//
// This file is one half of the contract. The other half is the Go client's
// `packages/go/internal/signal`, which declares the same messages field for field and is kept
// in step by hand — Go cannot import TypeScript, so nothing mechanical enforces it. Changing a
// message here without changing it there is how a room goes quiet with no error anywhere.
//
// Adding an optional field is safe in both directions: the client updates itself while the
// server is deployed separately, so a binary from last week talks to the server from today.
// Renaming or repurposing one is not.

// === Common Types ===

export interface Participant {
  id: string;
  username: string;
  joinedAt: string;
  /** The colour the participant chose for their name, `#rrggbb`. Absent from older clients. */
  color?: string;
}

export interface Room {
  id: string;
  name: string;
  createdAt: string;
  participantCount?: number;
}

// === Signaling Messages ===

export interface JoinRoomMessage {
  type: 'join-room';
  roomId: string;
  username: string;
  /** See `Participant.color`. */
  color?: string;
}

export interface RoomJoinedMessage {
  type: 'room-joined';
  roomId: string;
  yourId: string;
  participants: Participant[];
}

export interface ParticipantJoinedMessage {
  type: 'participant-joined';
  participant: Participant;
}

export interface ParticipantLeftMessage {
  type: 'participant-left';
  participantId: string;
}

// The two WebRTC payloads the server forwards without ever reading. They were
// `RTCSessionDescriptionInit` / `RTCIceCandidateInit`, which are DOM types: a Node-only package
// was pulling in the whole browser lib for three fields it never touches. These are the shapes
// that actually cross the wire — `internal/signal` declares exactly them.
export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface OfferMessage {
  type: 'offer';
  fromId: string;
  toId: string;
  sdp: SessionDescription;
}

export interface AnswerMessage {
  type: 'answer';
  fromId: string;
  toId: string;
  sdp: SessionDescription;
}

export interface IceCandidateMessage {
  type: 'ice-candidate';
  fromId: string;
  toId: string;
  candidate: IceCandidate;
}

// === Chat Messages ===

export interface ChatMessage {
  type: 'chat-message';
  id: string;
  roomId: string;
  username: string;
  /** The sender's chosen colour, set by the server from the join, like `username`. */
  color?: string;
  content: string;
  timestamp: number;
}

export interface ChatBroadcastMessage {
  type: 'chat-broadcast';
  message: ChatMessage;
}

// === Media State Messages ===

export interface MuteStateMessage {
  type: 'mute-state';
  fromId: string;
  isAudioMuted: boolean;
  isVideoMuted?: boolean;
}

export interface ScreenShareStateMessage {
  type: 'screen-share-state';
  fromId: string;
  isScreenSharing: boolean;
}

// === Error Messages ===

export interface ErrorMessage {
  type: 'error';
  message: string;
}

// === Discriminated Union ===

export type WSMessage =
  | JoinRoomMessage
  | RoomJoinedMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | OfferMessage
  | AnswerMessage
  | IceCandidateMessage
  | MuteStateMessage
  | ScreenShareStateMessage
  | ChatMessage
  | ChatBroadcastMessage
  | ErrorMessage;
