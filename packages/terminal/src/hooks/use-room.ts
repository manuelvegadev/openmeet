/**
 * Thin React binding over the engine process. All room logic lives in
 * `engine/room-engine.ts`; this hook forwards commands and mirrors snapshots into state so
 * the components keep the same props they always had.
 */
import type { ChatMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEngine } from '../engine/client.js';
import { type ConnectionStats, initialRoomState, type RoomEvent, type RoomState } from '../engine/protocol.js';
import type { AudioDeviceSelection } from '../lib/audio/backend.js';
import type { ScreenDevice } from '../lib/devices.js';
import { diagnosticsEnabled, drainRenderStats, formatRenderStats, startLoopDelayMonitor } from '../lib/diagnostics.js';

export type { ConnectionStats, RoomEvent };

/** Room log entries kept in state; the UI shows the last 30. */
const MAX_ROOM_EVENTS = 300;

interface UseRoomOptions {
  serverUrl: string;
  roomId: string;
  username: string;
  deviceSelection: AudioDeviceSelection;
  debug?: boolean;
  videoEnabled?: boolean;
  videoDevice?: string;
}

interface UseRoomReturn extends RoomState {
  chatMessages: ChatMessage[];
  roomEvents: RoomEvent[];
  sendMessage: (content: string) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleOverlay: () => void;
  startScreenSharing: (device: ScreenDevice) => void;
  stopScreenSharing: () => void;
  togglePeerVideo: (peerId: string) => void;
  togglePeerScreen: (peerId: string) => void;
  setPeerVolume: (peerId: string, volume: number) => void;
  updateDevices: (selection: AudioDeviceSelection) => void;
  toggleDebug: () => void;
  leave: () => void;
}

export function useRoom(options: UseRoomOptions): UseRoomReturn {
  const { serverUrl, roomId, username, deviceSelection, debug = false, videoEnabled = false, videoDevice } = options;
  const engine = getEngine();

  const [state, setState] = useState<RoomState>(() => ({ ...initialRoomState(), videoEnabled, debugMode: debug }));
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [roomEvents, setRoomEvents] = useState<RoomEvent[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);
  const leftRef = useRef(false);

  // Join on mount, leave on unmount. The engine process itself outlives the room screen.
  useEffect(() => {
    leftRef.current = false;
    const unsubscribe = engine.subscribe((event) => {
      switch (event.type) {
        case 'state':
          setState(event.state);
          break;
        case 'chat':
          setChatMessages((prev) => [...prev, event.message]);
          break;
        case 'room-event':
          setRoomEvents((prev) => [...prev.slice(-(MAX_ROOM_EVENTS - 1)), event.event]);
          break;
        case 'engine-exited':
          if (!leftRef.current) setEngineError(event.reason);
          break;
      }
    });

    engine.send({
      type: 'join',
      options: { serverUrl, roomId, username, deviceSelection, debug, videoEnabled, videoDevice },
    });

    return () => {
      unsubscribe();
      if (!leftRef.current) {
        leftRef.current = true;
        engine.send({ type: 'leave' });
      }
    };
  }, [engine, serverUrl, roomId, username, deviceSelection, debug, videoEnabled, videoDevice]);

  // Diagnostics for *this* process (loop stalls, render cost), logged through the engine
  // so both processes end up in one file.
  useEffect(() => {
    if (!diagnosticsEnabled(debug)) return;
    const log = (message: string) => engine.send({ type: 'log', message });
    const stopLoopMonitor = startLoopDelayMonitor('TUI', log);
    const renderTimer = setInterval(() => {
      const r = drainRenderStats();
      if (r) log(formatRenderStats(r));
    }, 10_000);
    return () => {
      stopLoopMonitor();
      clearInterval(renderTimer);
    };
  }, [debug, engine]);

  const sendMessage = useCallback((content: string) => engine.send({ type: 'send-chat', content }), [engine]);
  const toggleMute = useCallback(() => engine.send({ type: 'toggle-mute' }), [engine]);
  const toggleVideo = useCallback(() => engine.send({ type: 'toggle-video' }), [engine]);
  const toggleOverlay = useCallback(() => engine.send({ type: 'toggle-overlay' }), [engine]);
  const startScreenSharing = useCallback(
    (device: ScreenDevice) => engine.send({ type: 'start-screen-share', device }),
    [engine],
  );
  const stopScreenSharing = useCallback(() => engine.send({ type: 'stop-screen-share' }), [engine]);
  const togglePeerVideo = useCallback((peerId: string) => engine.send({ type: 'toggle-peer-video', peerId }), [engine]);
  const togglePeerScreen = useCallback(
    (peerId: string) => engine.send({ type: 'toggle-peer-screen', peerId }),
    [engine],
  );
  // The engine clamps and echoes the value back in the next snapshot (≤100 ms).
  const setPeerVolume = useCallback(
    (peerId: string, volume: number) => engine.send({ type: 'set-peer-volume', peerId, volume }),
    [engine],
  );
  const updateDevices = useCallback(
    (selection: AudioDeviceSelection) => engine.send({ type: 'update-devices', selection }),
    [engine],
  );
  const toggleDebug = useCallback(() => engine.send({ type: 'toggle-debug' }), [engine]);
  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    engine.send({ type: 'leave' });
  }, [engine]);

  return {
    ...state,
    chatMessages,
    roomEvents,
    error: engineError ?? state.error,
    sendMessage,
    toggleMute,
    toggleVideo,
    toggleOverlay,
    startScreenSharing,
    stopScreenSharing,
    togglePeerVideo,
    togglePeerScreen,
    setPeerVolume,
    updateDevices,
    toggleDebug,
    leave,
  };
}
