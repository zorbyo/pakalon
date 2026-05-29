/**
 * Extension system types — matches Copilot CLI's extension architecture.
 *
 * Extensions run as separate Node.js child processes communicating via
 * JSON-RPC over stdio. They can:
 * - Register custom tools
 * - Register lifecycle hooks (onSessionStart, onPreToolUse, etc.)
 * - Subscribe to session events
 * - Send programmatic messages to the agent
 * - Hot-reload mid-session
 */

// ---------------------------------------------------------------------------
// Extension Manifest
// ---------------------------------------------------------------------------

export interface ExtensionManifest {
  /** Extension name (unique identifier) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Version string (semver) */
  version?: string;
  /** Entry point file (relative to extension directory) */
  entry: string;
  /** Required permissions */
  permissions?: string[];
  /** Extension author */
  author?: string;
}

// ---------------------------------------------------------------------------
// JSON-RPC Protocol
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Extension → CLI Methods (extension calls these on the CLI)
// ---------------------------------------------------------------------------

export type ExtensionToCliMethod =
  | "registerTool"
  | "registerHook"
  | "subscribeToEvent"
  | "unregisterTool"
  | "unsubscribeFromEvent"
  | "sendNotification"
  | "ui.elicitation"
  | "session.send"
  | "session.sendAndWait";

// ---------------------------------------------------------------------------
// CLI → Extension Methods (CLI calls these on the extension)
// ---------------------------------------------------------------------------

export type CliToExtensionMethod =
  | "initialize"
  | "shutdown"
  | "executeTool"
  | "hook.onSessionStart"
  | "hook.onUserPromptSubmitted"
  | "hook.onPreToolUse"
  | "hook.onPostToolUse"
  | "hook.onErrorOccurred"
  | "hook.onSessionEnd"
  | "hotReload";

// ---------------------------------------------------------------------------
// Hook Types
// ---------------------------------------------------------------------------

export type HookType =
  | "onSessionStart"
  | "onUserPromptSubmitted"
  | "onPreToolUse"
  | "onPostToolUse"
  | "onErrorOccurred"
  | "onSessionEnd";

/** @deprecated Use HookType instead */
export type ExtensionHookType = HookType;

export interface HookRegistration {
  hookType: HookType;
  /** Optional filter — only fire for matching tool names */
  match?: string;
  /** Priority (lower = runs first) */
  priority?: number;
}

export interface HookDecision {
  /** "allow" lets execution proceed. "deny" blocks it. "modify" changes args. */
  action: "allow" | "deny" | "modify";
  /** Modified tool arguments (only when action = "modify") */
  modifiedArgs?: Record<string, unknown>;
  /** Reason for deny (shown to user) */
  reason?: string;
}

export interface HookContext {
  hookType: HookType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  sessionId?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Session Events
// ---------------------------------------------------------------------------

export type SessionEventType =
  | "assistant.message"
  | "assistant.turn_start"
  | "tool.execution_start"
  | "tool.execution_complete"
  | "user.message"
  | "session.idle"
  | "session.error"
  | "session.shutdown"
  | "permission.requested"
  | "session.start";

export interface SessionEvent<T = unknown> {
  type: SessionEventType;
  timestamp: string;
  sessionId?: string;
  data: T;
}

export type SessionEventListener<T = unknown> = (event: SessionEvent<T>) => void;

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export interface ToolRegistration {
  /** Tool name (must be unique across extensions) */
  name: string;
  /** Description shown to the AI model */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// UI Elicitation
// ---------------------------------------------------------------------------

export interface ElicitationField {
  name: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "multiselect";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
  description?: string;
}

export interface ElicitationRequest {
  title: string;
  description?: string;
  fields: ElicitationField[];
  actions: Array<{ id: string; label: string }>;
}

export interface ElicitationResult {
  action: string;
  values: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Extension Instance State
// ---------------------------------------------------------------------------

export type ExtensionStatus = "starting" | "running" | "stopped" | "error";

export interface ExtensionInstance {
  manifest: ExtensionManifest;
  /** Absolute path to extension directory */
  path: string;
  /** Child process PID */
  pid: number | null;
  /** Current status */
  status: ExtensionStatus;
  /** Registered tools */
  registeredTools: ToolRegistration[];
  /** Registered hooks */
  registeredHooks: HookRegistration[];
  /** Subscribed events */
  subscribedEvents: SessionEventType[];
  /** Last error (if status = "error") */
  lastError?: string;
  /** Start time */
  startedAt?: string;
}

// ---------------------------------------------------------------------------
// Extension SDK (what extensions receive)
// ---------------------------------------------------------------------------

export interface ExtensionSDK {
  /** Send a JSON-RPC request to the CLI */
  request: (method: ExtensionToCliMethod, params?: Record<string, unknown>) => Promise<unknown>;
  /** Send a JSON-RPC notification (fire-and-forget) */
  notify: (method: string, params?: Record<string, unknown>) => void;
  /** Log a message (appears in CLI debug log) */
  log: (level: "info" | "warn" | "error", message: string) => void;
}
