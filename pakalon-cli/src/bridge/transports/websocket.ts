/**
 * WebSocket transport for bridge communication.
 *
 * Provides a WebSocket-based transport for real-time session communication
 * with the remote server. Supports reconnection, heartbeat, and message
 * batching.
 */

import type { BridgeTransport } from "../types.js";

export type WebSocketTransportOptions = {
  url: string;
  authToken?: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  onMessage?: (message: unknown) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onConnect?: () => void;
};

const DEFAULT_RECONNECT_INTERVAL = 3000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

export class WebSocketTransport implements BridgeTransport {
  private url: string;
  private authToken?: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private heartbeatInterval: number;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: string[] = [];
  private lastSequenceNum = 0;
  private _droppedBatchCount = 0;
  private _closed = false;

  private onMessageCallback?: (message: unknown) => void;
  private onErrorCallback?: (error: Error) => void;
  private onCloseCallback?: (closeCode?: number) => void;
  private onConnectCallback?: () => void;

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url;
    this.authToken = options.authToken;
    this.reconnect = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.heartbeatInterval = options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;
    this.onMessageCallback = options.onMessage;
    this.onErrorCallback = options.onError;
    this.onCloseCallback = options.onClose;
    this.onConnectCallback = options.onConnect;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const headers: Record<string, string> = {};
        if (this.authToken) {
          headers["Authorization"] = `Bearer ${this.authToken}`;
        }

        this.ws = new WebSocket(this.url, {
          headers,
        });

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          this.onConnectCallback?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);

            if (data.sequence !== undefined) {
              this.lastSequenceNum = Math.max(this.lastSequenceNum, data.sequence);
            }

            this.onMessageCallback?.(data);
          } catch {
            this.onMessageCallback?.(event.data);
          }
        };

        this.ws.onerror = () => {
          this.onErrorCallback?.(new Error("WebSocket error"));
        };

        this.ws.onclose = (event) => {
          this.connected = false;
          this.stopHeartbeat();
          this.onCloseCallback?.(event.code);

          if (this.reconnect && !this._closed && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this._closed = true;
    this.reconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  async write(message: unknown): Promise<void> {
    const data = JSON.stringify(message);

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(data);
      return;
    }

    this.ws.send(data);
  }

  async writeBatch(messages: unknown[]): Promise<void> {
    for (const message of messages) {
      if (this._closed) break;
      await this.write(message);
    }
  }

  close(): void {
    this.disconnect();
  }

  isConnectedStatus(): boolean {
    return this.connected;
  }

  getStateLabel(): string {
    if (!this.ws || this._closed) return "closed";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return this.connected ? "connected" : "disconnected";
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return "closed";
    }
  }

  setOnData(callback: (data: string) => void): void {
    this.onMessageCallback = callback;
  }

  setOnClose(callback: (closeCode?: number) => void): void {
    this.onCloseCallback = callback;
  }

  setOnConnect(callback: () => void): void {
    this.onConnectCallback = callback;
  }

  getLastSequenceNum(): number {
    return this.lastSequenceNum;
  }

  get droppedBatchCount(): number {
    return this._droppedBatchCount;
  }

  reportState(_state: string): void {
    // State reporting to server
  }

  reportMetadata(_metadata: Record<string, unknown>): void {
    // Metadata reporting to server
  }

  reportDelivery(_eventId: string, _status: "processing" | "processed"): void {
    // Delivery confirmation to server
  }

  async flush(): Promise<void> {
    // Flushing handled by message queue
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "keepalive" }));
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this._closed) return;

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this._closed) {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (msg && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(msg);
      }
    }
  }

  isClosedStatus(): boolean {
    return this._closed || !this.ws || this.ws.readyState === WebSocket.CLOSED;
  }
}

export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport(options);
}