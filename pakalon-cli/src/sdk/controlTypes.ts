/**
 * SDK Control Types
 * Types for SDK control messages (permissions, responses, etc.)
 */

/**
 * Tool permission request from SDK
 */
export interface SDKControlPermissionRequest {
  subtype: 'can_use_tool';
  tool_name: string;
  input: Record<string, unknown>;
  permission_suggestions?: PermissionUpdate[];
  blocked_path?: string;
  decision_reason?: string;
  title?: string;
  display_name?: string;
  tool_use_id: string;
  agent_id?: string;
  description?: string;
}

/**
 * Permission mode for tool execution
 */
export type PermissionMode = 'bypass' | 'attach' | 'review' | 'deny' | 'bypass-assume-yes' | 'bypass-takeover';

/**
 * Permission update suggestion
 */
export interface PermissionUpdate {
  type: 'allow' | 'deny' | 'suggest_allow' | 'suggest_deny';
  tool?: string;
  path?: string;
}

/**
 * MCP server status
 */
export interface McpServerStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools: string[];
}

/**
 * SDK Control Response
 */
export interface SDKControlResponse {
  subtype: 'control_response';
  request_id: string;
  approved?: boolean;
  permission_mode?: PermissionMode;
  model?: string;
  max_thinking_tokens?: number | null;
  mcpServers?: McpServerStatus[];
  error?: string;
}

/**
 * Stdout message types
 */
export type StdoutMessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'tool_use'
  | 'tool_result'
  | 'input'
  | 'output'
  | 'error'
  | 'info'
  | 'debug'
  | '打断'
  | 'interrupted'
  | 'complete'
  | 'abort'
  | 'exit';

/**
 * Stdout message subtype for special messages
 */
export type StdoutMessageSubtype =
  | 'permission'
  | 'compact_boundary'
  | 'microcompact_boundary'
  | 'snip_boundary'
  | 'channel_error'
  | 'rate_limit'
  | 'error';

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/**
 * Cost information
 */
export interface CostInfo {
  inputCents: number;
  outputCents: number;
  totalCents: number;
  inputCacheDiscount?: number;
}

/**
 * Stdout message format
 */
export interface StdoutMessage {
  type: StdoutMessageType;
  subtype?: StdoutMessageSubtype;
  content?: string;
  tool_use_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
  tool_error?: boolean;
  usage?: TokenUsage;
  cost?: CostInfo;
  model?: string;
  session_id?: string;
  timestamp?: number;
  uuid?: string;
  agent_id?: string;
  channel_id?: string;
  error?: string;
  render?: boolean;
  compactMetadata?: CompactMetadata;
}

/**
 * Compact metadata for boundary messages
 */
export interface CompactMetadata {
  type?: string;
  preservedSegment?: {
    headUuid: string;
    anchorUuid: string;
    tailUuid: string;
  };
  originalCount?: number;
  compactedCount?: number;
}

/**
 * Control request types
 */
export type SDKControlRequest =
  | SDKControlPermissionRequest
  | SDKControlSetPermissionModeRequest
  | SDKControlSetModelRequest
  | SDKControlSetMaxThinkingTokensRequest
  | SDKControlMcpStatusRequest
  | SDKControlGetContextUsageRequest;

/**
 * Set permission mode request
 */
export interface SDKControlSetPermissionModeRequest {
  subtype: 'set_permission_mode';
  mode: PermissionMode;
  ultraplan?: boolean;
}

/**
 * Set model request
 */
export interface SDKControlSetModelRequest {
  subtype: 'set_model';
  model?: string;
}

/**
 * Set max thinking tokens request
 */
export interface SDKControlSetMaxThinkingTokensRequest {
  subtype: 'set_max_thinking_tokens';
  max_thinking_tokens: number | null;
}

/**
 * MCP status request
 */
export interface SDKControlMcpStatusRequest {
  subtype: 'mcp_status';
}

/**
 * Get context usage request
 */
export interface SDKControlGetContextUsageRequest {
  subtype: 'get_context_usage';
}

/**
 * Context usage category
 */
export interface ContextCategory {
  name: string;
  tokens: number;
  color: string;
  isDeferred?: boolean;
}

/**
 * Context grid square
 */
export interface ContextGridSquare {
  color: string;
  isFilled: boolean;
  categoryName: string;
  tokens: number;
}

/**
 * Context usage response
 */
export interface SDKControlGetContextUsageResponse {
  totalTokens: number;
  maxTokens: number;
  categories: ContextCategory[];
  grid: ContextGridSquare[];
}

/**
 * Result of tool permission decision
 */
export interface ToolPermissionResult {
  authorized: boolean;
  mode?: PermissionMode;
  skipConfirmation?: boolean;
}