/**
 * SSE (Server-Sent Events) transport for bridge communication.
 *
 * Provides an SSE-based transport for receiving real-time updates
 * from the server, with HTTP POST for sending messages.
 */

import type { BridgeTransport } from "../types.js";

export type SSETransportOptions = {
  url: string;
  authToken?: string;
  sessionId?: string;
  initialSequenceNum?: number;
  getAuthHeaders?: () => Record<string, string>;
  onMessage?: (message: unknown) => void;
  onEvent?: (event: { event_id: string }) => void;
  onError?: (error: Error) => void;
  onClose?: (closeCode?: number) => void;
  onConnect?: () => void;
};

export class SSETransport implements BridgeTransport {
  private url: URL;
  private authToken?: string;
  private sessionId?: string;
  private initialSequenceNum?: number;
  private getAuthHeaders?: () => Record<string, string>;
  private onMessageCallback?: (message: unknown) => void;
  private onEventCallback?: (event: { event_id: string }) => void;
  private onErrorCallback?: (error: Error) => void;
  private onCloseCallback?: (closeCode?: number) => void;
  private onConnectCallback?: () => void;

  private eventSource: EventSource | null = null;
  private controller: AbortController | null = null;
  private lastSequenceNum = 0;
  private connected = false;
  private _closed = false;
  private _droppedBatchCount = 0;

  constructor(options: SSETransportOptions) {
    this.url = new URL(options.url);
    this.authToken = options.authToken;
    this.sessionId = options.sessionId;
    this.initialSequenceNum = options.initialSequenceNum;
    this.getAuthHeaders = options.getAuthHeaders;
    this.onMessageCallback = options.onMessage;
    this.onEventCallback = options.onEvent;
    this.onErrorCallback = options.onError;
    this.onCloseCallback = options.onClose;
    this.onConnectCallback = options.onConnect;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const connectUrl = this.buildConnectUrl();
        this.controller = new AbortController();

        this.eventSource = new EventSource(connectUrl, {
          withCredentials: !!this.authToken,
        });

        this.eventSource.onopen = () => {
          this.connected = true;
          this.onConnectCallback?.();
          resolve();
        };

        this.eventSource.onmessage = (event) => {
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

        this.eventSource.onerror = () => {
          const closeCode = this.getCloseCode();
          this.connected = false;
          this.eventSource?.close();

          if (!this._closed) {
            this.onErrorCallback?.(new Error("SSE connection error"));
            this.onCloseCallback?.(closeCode);
          }
        };

        // Custom event types
        this.eventSource.addEventListener("event", (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            this.onEventCallback?.(data);
          } catch {
            // Ignore parse errors
          }
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this._closed = true;
    this.connected = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
  }

  async write(message: unknown): Promise<void> {
    const postUrl = this.buildPostUrl();

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(this.getAuthHeaders?.() ?? (this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})),
      };

      const response = await fetch(postUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this.controller?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        this.onErrorCallback?.(err);
      }
    }
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
    return this.connected && !this._closed;
  }

  isClosedStatus(): boolean {
    return this._closed || !this.eventSource || this.eventSource.readyState === EventSource.CLOSED;
  }

  getStateLabel(): string {
    if (this._closed || !this.eventSource) return "closed";
    switch (this.eventSource.readyState) {
      case EventSource.CONNECTING:
        return "connecting";
      case EventSource.OPEN:
        return this.connected ? "connected" : "disconnected";
      case EventSource.CLOSED:
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

  setOnEvent(callback: (event: { event_id: string }) => void): void {
    this.onEventCallback = callback;
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
    // Flush is no-op for SSE transport
  }

  private buildConnectUrl(): string {
    const url = new URL(this.url);

    if (this.authToken) {
      url.searchParams.set("token", this.authToken);
    }

    if (this.sessionId) {
      url.searchParams.set("session_id", this.sessionId);
    }

    if (this.initialSequenceNum !== undefined && this.initialSequenceNum > 0) {
      url.searchParams.set("from_sequence_num", String(this.initialSequenceNum));
    }

    url.searchParams.set("format", "sse");

    return url.toString();
  }

  private buildPostUrl(): string {
    const url = new URL(this.url);

    if (this.authToken) {
      url.searchParams.set("token", this.authToken);
    }

    if (this.sessionId) {
      url.searchParams.set("session_id", this.sessionId);
    }

    return url.toString();
  }

  private getCloseCode(): number | undefined {
    // SSE doesn't provide close codes, return undefined
    return undefined;
  }
}

export function createSSETransport(options: SSETransportOptions): SSETransport {
  return new SSETransport(options);
}