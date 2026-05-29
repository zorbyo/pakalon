import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EventSource } from 'eventsource';

export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class SseTransport implements Transport {
  private _handler: ((message: JSONRPCMessage) => void) | null = null;
  private _errorHandler: ((error: Error) => void) | null = null;
  private _closeHandler: (() => void) | null = null;
  private _eventSource: EventSource | null = null;
  private _connected = false;
  private messageQueue: JSONRPCMessage[] = [];
  private _endpoint: string;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: SseTransportOptions) {
    this._endpoint = options.url;

    const eventSourceInit: EventSourceInit = {
      withCredentials: false,
    };

    this._eventSource = new EventSource(this._endpoint, eventSourceInit);

    this._eventSource.onerror = (err) => {
      this._errorHandler?.(err instanceof Error ? err : new Error(String(err)));
    };

    this._eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as JSONRPCMessage;
        if (this._handler) {
          this._handler(message);
        } else {
          this.messageQueue.push(message);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this._eventSource.addEventListener('message', (event) => {
      try {
        const message = JSON.parse((event as MessageEvent).data) as JSONRPCMessage;
        if (this._handler) {
          this._handler(message);
        } else {
          this.messageQueue.push(message);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    this._eventSource.onopen = () => {
      this._connected = true;
    };
  }

  async start(): Promise<void> {
    if (this._eventSource?.readyState === EventSource.OPEN) {
      this._connected = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      if (!this._eventSource) {
        reject(new Error('EventSource not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('SSE connection timeout'));
      }, 30000);

      this._eventSource.onopen = () => {
        clearTimeout(timeout);
        this._connected = true;
        resolve();
      };
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected) {
      throw new Error('Transport not connected');
    }

    const response = await fetch(this._endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
  }

  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }
    this._connected = false;
    this.messageQueue = [];

    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }

    this._closeHandler?.();
  }

  setMessageHandler(handler: (message: JSONRPCMessage) => void): void {
    this._handler = handler;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        handler(message);
      }
    }
  }

  setErrorHandler(handler: (error: Error) => void): void {
    this._errorHandler = handler;
  }

  setCloseHandler(handler: () => void): void {
    this._closeHandler = handler;
  }

  get connected(): boolean {
    return this._connected;
  }

  get closed(): boolean {
    return !this._connected;
  }
}