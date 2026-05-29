import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export class HttpTransport implements Transport {
  private _handler: ((message: JSONRPCMessage) => void) | null = null;
  private _errorHandler: ((error: Error) => void) | null = null;
  private _closeHandler: (() => void) | null = null;
  private _connected = false;
  private messageQueue: JSONRPCMessage[] = [];
  private _baseUrl: string;
  private _abortController: AbortController | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(options: HttpTransportOptions) {
    this._baseUrl = options.url;
  }

  async start(): Promise<void> {
    this._connected = true;
    this._abortController = new AbortController();

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this._handler) {
        this._handler(message);
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected) {
      throw new Error('Transport not connected');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(this._baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: this._abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsedMessage = JSON.parse(line) as JSONRPCMessage;
                if (this._handler) {
                  this._handler(parsedMessage);
                } else {
                  this.messageQueue.push(parsedMessage);
                }
              } catch {
                // Ignore malformed JSON
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }
    this._connected = false;
    this.messageQueue = [];

    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
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