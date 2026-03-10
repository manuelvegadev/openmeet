// === Common Types ===

export interface Participant {
  id: string;
  username: string;
  joinedAt: string;
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

export interface OfferMessage {
  type: 'offer';
  fromId: string;
  toId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface AnswerMessage {
  type: 'answer';
  fromId: string;
  toId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateMessage {
  type: 'ice-candidate';
  fromId: string;
  toId: string;
  candidate: RTCIceCandidateInit;
}

// === Chat Messages ===

export interface ChatMessage {
  type: 'chat-message';
  id: string;
  roomId: string;
  username: string;
  content: string;
  contentType: 'text' | 'image' | 'file';
  fileUrl?: string;
  fileName?: string;
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
