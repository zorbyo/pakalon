import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export class InProcessTransport implements Transport {
  private peer: InProcessTransport | undefined;
  private _closed = false;
  private messageQueue: JSONRPCMessage[] = [];

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }
    queueMicrotask(() => {
      this.peer?.onmessage?.(message);
    });
  }

  async close(): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this.onclose?.();
    if (this.peer && !this.peer._closed) {
      this.peer._closed = true;
      this.peer.onclose?.();
    }
  }

  /** @internal */
  _setPeer(peer: InProcessTransport): void {
    this.peer = peer;
  }

  get closed(): boolean {
    return this._closed;
  }
}

export function createLinkedTransportPair(): [Transport, Transport] {
  const a = new InProcessTransport();
  const b = new InProcessTransport();
  a._setPeer(b);
  b._setPeer(a);
  return [a, b];
}