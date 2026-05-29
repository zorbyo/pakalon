/**
 * WebSocket Transport for MCP (Model Context Protocol)
 *
 * This module provides a WebSocket transport implementation for MCP clients.
 * It wraps a raw WebSocket-like client and implements the MCP transport protocol.
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import logger from '@/utils/logger.js';

type WsClientLike = {
  readonly readyState: number;
  close(): void;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: (code: number) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
};

const WS_OPEN = 1;

export class WebSocketTransport extends EventEmitter {
  private ws: WsClientLike;
  private connected = false;
  private messageBuffer: string[] = [];
  private closed = false;

  constructor(wsClient: WsClientLike) {
    super();
    this.ws = wsClient;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.ws.on('message', (data: Buffer | string) => {
      try {
        const message = typeof data === 'string' ? data : data.toString();
        const parsed = JSON.parse(message) as JSONRPCMessage;
        this.emit('message', parsed);
      } catch (err) {
        logger.warn('[mcp/ws] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code: number) => {
      this.connected = false;
      this.emit('close', code);
    });

    this.ws.on('error', (err: Error) => {
      logger.error('[mcp/ws] WebSocket error:', err);
      this.emit('error', err);
    });
  }

  async start(): Promise<void> {
    if (this.ws.readyState === WS_OPEN) {
      this.connected = true;
      this.flushMessageBuffer();
    }
  }

  send(message: JSONRPCMessage): void {
    const data = JSON.stringify(message);
    if (this.connected && this.ws.readyState === WS_OPEN) {
      this.ws.send(data);
    } else {
      this.messageBuffer.push(data);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.messageBuffer = [];
    this.ws.close();
  }

  isConnected(): boolean {
    return this.connected && this.ws.readyState === WS_OPEN;
  }

  private flushMessageBuffer(): void {
    while (this.messageBuffer.length > 0) {
      const msg = this.messageBuffer.shift();
      if (msg && this.ws.readyState === WS_OPEN) {
        this.ws.send(msg);
      }
    }
  }

  onmessage = (handler: (message: JSONRPCMessage) => void): void => {
    this.on('message', handler);
  };

  onclose = (handler: (code: number) => void): void => {
    this.on('close', handler);
  };

  onerror = (handler: (error: Error) => void): void => {
    this.on('error', handler);
  };
}

export function createWebSocketTransport(wsClient: WsClientLike): WebSocketTransport {
  return new WebSocketTransport(wsClient);
}