import type { WSMessage } from '@openmeet/shared';
import WS from 'ws';

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

export class WebSocketClient {
  private ws: WS | null = null;
  private handlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private _connected = false;
  private disposed = false;

  constructor(url: string) {
    this.url = url;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.ws = new WS(this.url);

    this.ws.on('open', () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      for (const handler of this.connectionHandlers) {
        handler(true);
      }
    });

    this.ws.on('message', (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        for (const handler of this.handlers) {
          handler(message);
        }
      } catch {
        // Failed to parse message
      }
    });

    this.ws.on('close', () => {
      if (this.disposed) return;
      this._connected = false;
      for (const handler of this.connectionHandlers) {
        handler(false);
      }
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      if (this.disposed) return;
    });
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WS.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    }
  }
}
