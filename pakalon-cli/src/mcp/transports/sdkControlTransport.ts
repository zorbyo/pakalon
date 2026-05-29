import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export type SendMcpMessageCallback = (
  serverName: string,
  message: JSONRPCMessage,
) => Promise<JSONRPCMessage>;

export type ServerMessageCallback = (message: JSONRPCMessage) => void;

export class SdkControlClientTransport implements Transport {
  private _closed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private serverName: string,
    private sendMcpMessage: SendMcpMessageCallback,
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    const response = await this.sendMcpMessage(this.serverName, message);

    if (this.onmessage) {
      this.onmessage(response);
    }
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.onclose?.();
  }

  get closed(): boolean {
    return this._closed;
  }
}

export class SdkControlServerTransport implements Transport {
  private _closed = false;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private sendMcpMessage: ServerMessageCallback) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    this.sendMcpMessage(message);
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.onclose?.();
  }

  get closed(): boolean {
    return this._closed;
  }
}