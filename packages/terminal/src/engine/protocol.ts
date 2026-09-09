/**
 * IPC contract between the TUI process and the engine process.
 *
 * The engine owns everything time-sensitive: WebSocket signaling, WebRTC, audio capture,
 * mixing and playback, video capture/display. The TUI only renders snapshots and sends
 * commands. Both directions are plain JSON over Node's child-process IPC channel.
 */
import type { ChatMessage, Participant } from '@openmeet/shared';
import type { AudioDevice, AudioDeviceSelection } from '../lib/audio/backend.js';
import type { InputChannelPolicy } from '../lib/audio/channels.js';
import type { ScreenDevice } from '../lib/devices.js';

export interface ConnectionStats {
  sendBitrateKbps: number;
  recvBitrateKbps: number;
  rttMs: number;
  packetLossPercent: number;
  peerRecvBitrateKbps: Record<string, number>;
  peerLatencyMs: Record<string, number>;
}

export interface RoomEvent {
  /** Monotonic id — timestamps collide when several events land in the same millisecond. */
  id: number;
  timestamp: number;
  message: string;
  type: 'join' | 'leave' | 'screen' | 'mute' | 'info' | 'debug';
}

/** Everything the room screen renders. Sent as a whole; small enough to not bother diffing. */
export interface RoomState {
  connected: boolean;
  joined: boolean;
  myId: string | null;
  participants: Participant[];
  remoteMuteStates: Record<string, boolean>;
  remoteVideoMuteStates: Record<string, boolean>;
  remoteScreenShareStates: Record<string, boolean>;
  speakingStates: Record<string, boolean>;
  /** Quantized to the VU meter resolution so snapshots only change when a bar changes. */
  audioLevels: Record<string, number>;
  peerVolumes: Record<string, number>;
  peerVideoOpen: Record<string, boolean>;
  peerScreenOpen: Record<string, boolean>;
  connectionStats: ConnectionStats | null;
  joinedAt: number | null;
  isMuted: boolean;
  isVideoMuted: boolean;
  videoEnabled: boolean;
  /** Webcam capture available (video pipeline present and implemented on this OS). */
  webcamEnabled: boolean;
  overlayEnabled: boolean;
  isScreenSharing: boolean;
  error: string | null;
  debugMode: boolean;
}

export function initialRoomState(): RoomState {
  return {
    connected: false,
    joined: false,
    myId: null,
    participants: [],
    remoteMuteStates: {},
    remoteVideoMuteStates: {},
    remoteScreenShareStates: {},
    speakingStates: {},
    audioLevels: {},
    peerVolumes: {},
    peerVideoOpen: {},
    peerScreenOpen: {},
    connectionStats: null,
    joinedAt: null,
    isMuted: false,
    isVideoMuted: true,
    videoEnabled: false,
    webcamEnabled: false,
    overlayEnabled: false,
    isScreenSharing: false,
    error: null,
    debugMode: false,
  };
}

/** Capture conditioning chosen by the user (settings, possibly overridden by CLI flags). */
export interface InputOptions {
  channels: InputChannelPolicy;
  gainDb: number;
}

export interface JoinOptions {
  serverUrl: string;
  roomId: string;
  username: string;
  deviceSelection: AudioDeviceSelection;
  input: InputOptions;
  debug: boolean;
  videoEnabled: boolean;
  webcamEnabled: boolean;
  videoDevice?: string;
}

// ─── TUI → engine ─────────────────────────────────────────────────────

export type EngineCommand =
  | { type: 'list-devices'; requestId: number }
  | { type: 'mic-test-start'; selection: AudioDeviceSelection; input: InputOptions }
  | { type: 'mic-test-stop' }
  | { type: 'play-test-tone'; selection: AudioDeviceSelection }
  | { type: 'join'; options: JoinOptions }
  | { type: 'leave' }
  | { type: 'send-chat'; content: string }
  | { type: 'toggle-mute' }
  | { type: 'toggle-video' }
  | { type: 'toggle-overlay' }
  | { type: 'start-screen-share'; device: ScreenDevice }
  | { type: 'stop-screen-share' }
  | { type: 'toggle-peer-video'; peerId: string }
  | { type: 'toggle-peer-screen'; peerId: string }
  | { type: 'set-peer-volume'; peerId: string; volume: number }
  | { type: 'update-devices'; selection: AudioDeviceSelection }
  | { type: 'toggle-debug' }
  /** TUI hidden (minimized/unfocused per policy): the engine stops level/stats polling until visible. */
  | { type: 'set-visible'; visible: boolean }
  /** Append a line from the TUI process to the engine's debug log (e.g. render stats). */
  | { type: 'log'; message: string }
  | { type: 'shutdown' };

// ─── engine → TUI ─────────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'ready'; pid: number }
  | { type: 'devices'; requestId: number; inputs: AudioDevice[]; outputs: AudioDevice[] }
  | { type: 'mic-level'; rms: number }
  | { type: 'state'; state: RoomState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'room-event'; event: RoomEvent }
  | { type: 'left' }
  | { type: 'fatal'; message: string }
  /** Synthesized by EngineClient when the child process exits unexpectedly. */
  | { type: 'engine-exited'; reason: string };
