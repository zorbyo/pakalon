export interface Message {
  type: string;
  data?: Record<string, unknown>;
  timestamp: number;
  requestId?: string;
  sessionId?: string;
  userId?: string;
}

export interface Session {
  id: string;
  remoteId?: string;
  ownerId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  status: 'active' | 'paused' | 'ended' | 'archived';
  messages?: Message[];
  metadata?: Record<string, unknown>;
}

export interface BridgeConfig {
  url: string;
  authToken?: string;
  transport?: 'websocket' | 'sse';
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface RemoteSessionInfo {
  remoteId: string;
  ownerId: string;
  ownerName?: string;
  title?: string;
  createdAt: string;
  lastActivityAt: string;
  status: string;
}

export interface SessionShareRequest {
  remoteId: string;
  permissions?: 'read' | 'write' | 'admin';
  expiresIn?: number;
}

export interface SessionShareResponse {
  shareUrl: string;
  shareCode?: string;
  expiresAt?: string;
}

export interface InboundMessage {
  type: string;
  content: string | MessageContent[];
  agentId?: string;
  timestamp: string;
}

export interface MessageContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  source?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | MessageContent[];
  is_error?: boolean;
}

export interface SessionMetadata {
  sessionId: string;
  remoteId: string;
  ownerId: string;
  ownerName?: string;
  permissions: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface BridgetEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description?: string;
  requiresAuth?: boolean;
}

export const BRIDGE_ENDPOINTS: BridgetEndpoint[] = [
  { path: '/api/bridge/connect', method: 'GET', description: 'Connect to bridge via SSE', requiresAuth: true },
  { path: '/api/bridge/session/create', method: 'POST', description: 'Create a new session', requiresAuth: true },
  { path: '/api/bridge/session/:id/join', method: 'POST', description: 'Join an existing session', requiresAuth: true },
  { path: '/api/bridge/session/:id/leave', method: 'POST', description: 'Leave a session', requiresAuth: true },
  { path: '/api/bridge/session/:id/message', method: 'POST', description: 'Send message to session', requiresAuth: true },
  { path: '/api/bridge/session/:id/pause', method: 'POST', description: 'Pause a session', requiresAuth: true },
  { path: '/api/bridge/session/:id/resume', method: 'POST', description: 'Resume a session', requiresAuth: true },
  { path: '/api/bridge/session/:id/end', method: 'POST', description: 'End a session', requiresAuth: true },
  { path: '/api/bridge/sessions', method: 'GET', description: 'List active sessions', requiresAuth: true },
  { path: '/api/bridge/share/:id', method: 'POST', description: 'Share a session', requiresAuth: true },
  { path: '/api/bridge/share/:code/join', method: 'POST', description: 'Join via share code', requiresAuth: false },
];