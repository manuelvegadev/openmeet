import type { WSMessage } from '@openmeet/shared';

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private _connected = false;

  constructor(url: string) {
    this.url = url;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      for (const handler of this.connectionHandlers) {
        handler(true);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data as string);
        for (const handler of this.handlers) {
          handler(message);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      for (const handler of this.connectionHandlers) {
        handler(false);
      }
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
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
