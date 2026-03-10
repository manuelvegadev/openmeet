import type { WSMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketClient } from '@/lib/websocket';

const WS_URL = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const clientRef = useRef<WebSocketClient | null>(null);
  const onMessageRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);

  onMessageRef.current = onMessage;

  useEffect(() => {
    const client = new WebSocketClient(WS_URL);
    clientRef.current = client;

    const unsubscribe = client.subscribe((msg) => {
      onMessageRef.current(msg);
    });

    const unsubConnection = client.onConnectionChange((isConnected) => {
      setConnected(isConnected);
    });

    client.connect();

    return () => {
      unsubscribe();
      unsubConnection();
      client.disconnect();
    };
  }, []);

  const send = useCallback((message: WSMessage) => {
    clientRef.current?.send(message);
  }, []);

  return { send, connected };
}
