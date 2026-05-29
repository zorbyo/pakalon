/**
 * SDK Runtime Types
 * Non-serializable types (callbacks, interfaces with methods)
 */
import type { MCPServerConnection as McpServerConnection } from '../mcp/types.js';
import type { z } from 'zod';

/**
 * Effort level for model performance
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

/**
 * SDK Session interface
 */
export interface SDKSession {
  id: string;
  close(): Promise<void>;
  sendMessage(content: string): Promise<void>;
  onMessage(callback: (message: SDKMessage) => void): () => void;
}

/**
 * SDK Session options
 */
export interface SDKSessionOptions {
  dir?: string;
  model?: string;
  effort?: EffortLevel;
  systemPrompt?: string;
  timeout?: number;
}

/**
 * SDK Message
 */
export interface SDKMessage {
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result' | 'error';
  content?: string;
  tool?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
}

/**
 * SDK Result message
 */
export interface SDKResultMessage {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Session message with full metadata
 */
export interface SessionMessage {
  uuid: string;
  parentUuid?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | unknown[];
  createdAt: string;
}

/**
 * SDK Session info
 */
export interface SDKSessionInfo {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  description?: string;
  tags?: string[];
  isMain: boolean;
  dir?: string;
}

/**
 * Options for listing sessions
 */
export interface ListSessionsOptions {
  dir?: string;
  limit?: number;
  offset?: number;
  tags?: string[];
  mainOnly?: boolean;
}

/**
 * Options for getting session info
 */
export interface GetSessionInfoOptions {
  dir?: string;
}

/**
 * Options for getting session messages
 */
export interface GetSessionMessagesOptions {
  dir?: string;
  limit?: number;
  offset?: number;
  includeSystemMessages?: boolean;
}

/**
 * Options for session mutations (rename, tag)
 */
export interface SessionMutationOptions {
  dir?: string;
}

/**
 * Options for forking a session
 */
export interface ForkSessionOptions {
  dir?: string;
  upToMessageId?: string;
  title?: string;
}

/**
 * Result of fork session
 */
export interface ForkSessionResult {
  sessionId: string;
}

/**
 * Internal options for query
 */
export interface InternalOptions {
  dir?: string;
  model?: string;
  effort?: EffortLevel;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  mcpServers?: McpServerConnection[];
  prebuiltRepository?: string;
  enableRemoteControl?: boolean;
  remoteControlBridge?: RemoteControlBridgeOptions;
  onMessage?: (message: SDKMessage) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

/**
 * Remote control bridge options
 */
export interface RemoteControlBridgeOptions {
  sessionUrl: string;
  environmentId: string;
  bridgeSessionId: string;
}

/**
 * Public options for query
 */
export type Options = Omit<InternalOptions, 'prebuiltRepository' | 'enableRemoteControl' | 'remoteControlBridge'>;

/**
 * Tool definition for SDK
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | z.ZodTypeAny;
}

/**
 * MCP server config with instance
 */
export interface McpSdkServerConfigWithInstance {
  name: string;
  version?: string;
  tools: SdkMcpToolDefinition<any>[];
  server: unknown;
}

/**
 * SDK MCP tool definition
 */
export interface SdkMcpToolDefinition<Input extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | z.ZodType<Input>;
  execute?: (input: Input) => Promise<unknown>;
  annotations?: ToolAnnotations;
  searchHint?: string;
  alwaysLoad?: boolean;
}

/**
 * Tool annotations for display
 */
export interface ToolAnnotations {
  partnerId?: string;
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Internal query interface
 */
export interface InternalQuery {
  [Symbol.asyncIterator](): AsyncIterator<QueryYield>;
  write(prompt: string): Promise<void>;
  close(): Promise<void>;
  signal: AbortSignal;
}

/**
 * Query yield types
 */
export type QueryYield =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

/**
 * Query interface (public)
 */
export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<QueryYield>;
  close(): Promise<void>;
}

/**
 * Callback for tool execution
 */
export type ToolHandler = (input: Record<string, unknown>, extra: ToolContext) => Promise<ToolResult>;

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  sessionId: string;
  dir: string;
  signal: AbortSignal;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: string;
  error?: boolean;
}

/**
 * Status callback for long-running operations
 */
export type StatusCallback = (status: string) => void;

/**
 * Progress callback for operations with progress
 */
export type ProgressCallback = (progress: number, total: number, message?: string) => void;

/**
 * Any Zod raw shape for schema validation
 */
export type AnyZodRawShape = Record<string, unknown>;

/**
 * Infer shape type from Zod schema
 */
export type InferShape<T extends AnyZodRawShape> = T;

/**
 * Abort controller interface
 */
export interface AbortController {
  signal: AbortSignal;
  abort(): void;
}
