import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ChildProcess } from 'child_process';

export class StdioTransport implements Transport {
  private _handler: ((message: JSONRPCMessage) => void) | null = null;
  private _errorHandler: ((error: Error) => void) | null = null;
  private _closeHandler: (() => void) | null = null;
  private _connected = false;
  private _process: ChildProcess | null = null;
  private messageQueue: JSONRPCMessage[] = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(process: ChildProcess) {
    this._process = process;
    this._connected = true;

    process.stdout?.on('data', (data: Buffer) => {
      try {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as JSONRPCMessage;
            if (this._handler) {
              this._handler(message);
            } else {
              this.messageQueue.push(message);
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      } catch {
        // Ignore data parsing errors
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      if (this._errorHandler) {
        this._errorHandler(new Error(data.toString()));
      }
    });

    process.on('exit', () => {
      this._connected = false;
      this._closeHandler?.();
    });

    process.on('error', (err) => {
      this._errorHandler?.(err);
    });
  }

  async start(): Promise<void> {
    this._connected = true;
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this._handler) {
        this._handler(message);
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected || !this._process?.stdin) {
      throw new Error('Transport not connected');
    }

    this._process.stdin.write(JSON.stringify(message) + '\n');
  }

  async close(): Promise<void> {
    if (!this._connected) {
      return;
    }
    this._connected = false;
    this.messageQueue = [];

    if (this._process && !this._process.killed) {
      this._process.kill();
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