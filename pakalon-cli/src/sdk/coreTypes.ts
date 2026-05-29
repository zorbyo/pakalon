/**
 * SDK Core Types
 * Core type definitions for the Pakalon SDK
 */
import type { CoreMessage } from 'ai';

export interface SDKConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  dangerouslyAllowBrowsing?: boolean;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  description?: string;
  tags?: string[];
  isMain: boolean;
}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
  tags?: string[];
  mainOnly?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  createdAt: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[] };

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ToolResult {
  tool: string;
  input: Record<string, any>;
  output: string | Error;
  duration: number;
}

export interface QueryOptions {
  messages: CoreMessage[];
  tools?: Tool[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  context?: Record<string, string>;
}

export interface QueryResult {
  message: Message;
  tools?: ToolResult[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface SessionCreateOptions {
  model?: string;
  description?: string;
  tags?: string[];
  systemPrompt?: string;
  resumeSessionId?: string;
}

export interface SessionResumeOptions {
  sessionId: string;
  prompt?: string;
}

export type SDKEvent =
  | { type: 'session_start'; sessionId: string }
  | { type: 'session_end'; sessionId: string; reason: string }
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'tool_call'; sessionId: string; tool: string; input: Record<string, any> }
  | { type: 'tool_result'; sessionId: string; tool: string; output: any }
  | { type: 'error'; sessionId: string; error: string };

export interface SDKEventHandler {
  (event: SDKEvent): void | Promise<void>;
}

export type { CoreMessage };