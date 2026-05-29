import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface TransportOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export interface TransportMessageHandler {
  (message: JSONRPCMessage): void;
}

export interface TransportErrorHandler {
  (error: Error): void;
}

export interface TransportCloseHandler {
  (): void;
}

export type TransportType = 'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk';

export interface StdioTransportOptions extends TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseTransportOptions extends TransportOptions {
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
}

export interface HttpTransportOptions extends TransportOptions {
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
}

export type { JSONRPCMessage };