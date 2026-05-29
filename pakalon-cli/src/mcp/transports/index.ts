import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface TransportOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

export type TransportMessageHandler = (message: JSONRPCMessage) => void;
export type TransportErrorHandler = (error: Error) => void;
export type TransportCloseHandler = () => void;

export type TransportType = 'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk';

export interface StdioTransportOptions extends TransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export { InProcessTransport, createLinkedTransportPair } from './inProcessTransport.js';
export { SdkControlClientTransport, SdkControlServerTransport } from './sdkControlTransport.js';
export type { SendMcpMessageCallback, ServerMessageCallback } from './sdkControlTransport.js';
export { StdioTransport } from './stdioTransport.js';
export { SseTransport } from './sseTransport.js';
export { HttpTransport } from './httpTransport.js';
export type { Transport as McpTransport } from '@modelcontextprotocol/sdk/shared/transport.js';