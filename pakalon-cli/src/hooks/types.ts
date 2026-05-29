/**
 * Pakalon Hook System Types
 *
 * Event-driven automations that fire before/after tool executions.
 * Port from ECC hooks system for CLI integration.
 */

export type ToolName =
  | 'Bash'
  | 'Edit'
  | 'Write'
  | 'Read'
  | 'Glob'
  | 'Grep'
  | 'MultiEdit'
  | 'NotebookEdit'
  | 'Task'
  | 'TodoWrite'
  | 'websearch_web_search_exa'
  | 'WebFetch'
  | 'WebSearch';

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PreCompact'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop';

export type HookProfile = 'minimal' | 'standard' | 'strict';

export type HookExitCode = 0 | 1 | 2;

export interface HookInput {
  tool_name: ToolName;
  tool_input: ToolInputArgs;
  tool_output?: ToolOutput;
  session_id?: string;
  transcript_path?: string;
}

export interface ToolInputArgs {
  command?: string;
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  pattern?: string;
  include?: string;
  path?: string;
  output_mode?: string;
}

export interface ToolOutput {
  output?: string;
  error?: string;
  exit_code?: number;
}

export interface Hook {
  id: string;
  type: 'command' | 'function';
  command?: string;
  function?: string;
  async?: boolean;
  timeout?: number;
  description?: string;
}

export interface HookMatcher {
  event: HookEvent;
  matchers: HookMatcherRule[];
  hooks: Hook[];
  description?: string;
}

export type HookMatcherRule =
  | string
  | { tool?: ToolName | ToolName[]; tool_input?: Record<string, unknown> };

export interface HookConfig {
  profile?: HookProfile;
  disabled_hooks?: string[];
  hooks: {
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
    PostToolUseFailure?: HookMatcher[];
    PreCompact?: HookMatcher[];
    SessionStart?: HookMatcher[];
    SessionEnd?: HookMatcher[];
    Stop?: HookMatcher[];
  };
}

export interface HookResult {
  allowed: boolean;
  output?: string;
  warnings?: string[];
  blocked?: boolean;
  error?: string;
}

export interface HookExecutionContext {
  sessionId?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  hookProfile: HookProfile;
  disabledHooks: Set<string>;
}

export interface HookEventPayload {
  event: HookEvent;
  input: HookInput;
  context: HookExecutionContext;
  startTime: number;
}

export type HookHandler = (
  payload: HookEventPayload
) => Promise<HookResult> | HookResult;

export interface SessionState {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  toolCalls: number;
  transcriptPath?: string;
  packageManager?: string;
}

export interface CompactState {
  sessionId: string;
  contextSummary: string;
  keyDecisions: string[];
  pendingTasks: string[];
  savedAt: number;
}