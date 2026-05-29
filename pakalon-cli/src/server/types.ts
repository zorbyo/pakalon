/**
 * Server Types
 * Type definitions for direct connect and server functionality
 */
export interface ServerConfig {
  host?: string;
  port?: number;
  ssl?: boolean;
  sslCert?: string;
  sslKey?: string;
  authToken?: string;
  maxConnections?: number;
  timeout?: number;
}

export interface DirectConnectSession {
  id: string;
  host: string;
  port: number;
  ssl: boolean;
  createdAt: string;
  lastActivity: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  clientInfo?: ClientInfo;
}

export interface ClientInfo {
  clientId: string;
  clientVersion: string;
  platform: string;
  os: string;
}

export interface ServerMessage {
  type: 'session_start' | 'session_end' | 'session_error' | 'heartbeat' | 'command';
  sessionId?: string;
  payload?: any;
  timestamp: string;
}

export interface SessionOptions {
  sessionId?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export interface ConnectionState {
  connected: boolean;
  sessionId?: string;
  lastError?: string;
  reconnectAttempts: number;
}

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SessionEvent {
  type: SessionStatus;
  sessionId: string;
  timestamp: number;
  error?: string;
}

export interface ServerCapabilities {
  streaming: boolean;
  fileTransfer: boolean;
  shellExecution: boolean;
  multiSession: boolean;
  ssl: boolean;
}