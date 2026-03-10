import type { WSMessage } from '@openmeet/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketClient } from '@/lib/websocket';

const WS_URL = import.meta.env.VITE_WS_URL ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;

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

    client.connect();

    const checkConnection = setInterval(() => {
      setConnected(client.connected);
    }, 500);

    return () => {
      clearInterval(checkConnection);
      unsubscribe();
      client.disconnect();
    };
  }, []);

  const send = useCallback((message: WSMessage) => {
    clientRef.current?.send(message);
  }, []);

  return { send, connected };
}
