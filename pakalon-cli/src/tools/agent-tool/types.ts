/**
 * Agent System Type Definitions
 * Shared types for multi-agent orchestration
 */
import type { Tool, Tools, ToolUseContext } from '@/ai/tool-registry';
import type { CoreMessage } from 'ai';

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: string[];
  hooks?: HooksSettings;
  color?: AgentColorName;
  effort?: EffortValue;
  permissionMode?: PermissionMode;
  background?: boolean;
  initialPrompt?: string;
  memory?: AgentMemoryScope;
  isolation?: 'worktree' | 'remote';
  omitClaudeMd?: boolean;
}

export type AgentMemoryScope = 'user' | 'project' | 'local';

export type PermissionMode =
  | 'acceptEdits'
  | 'ask'
  | 'auto'
  | 'bypassPermissions'
  | 'bubble'
  | 'plan'
  | 'restrictToolUse';

export type EffortValue = 'minimum' | 'low' | 'medium' | 'high' | 'maximum';

export type AgentColorName =
  | 'slate'
  | 'gray'
  | 'zinc'
  | 'neutral'
  | 'stone'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose';

export interface HooksSettings {
  preToolUse?: PreToolUseHook[];
  postToolUse?: PostToolUseHook[];
  preCompact?: PreCompactHook[];
  postCompact?: PostCompactHook[];
  permissionRequest?: PermissionRequestHook[];
  permissionDenied?: PermissionDeniedHook[];
  postSampling?: PostSamplingHook[];
  stop?: StopHook[];
  sessionStart?: SessionStartHook[];
}

export interface PreToolUseHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PostToolUseHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PreCompactHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PostCompactHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PermissionRequestHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PermissionDeniedHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface PostSamplingHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface StopHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface SessionStartHook {
  name: string;
  description?: string;
  handler: (context: HookContext) => Promise<HookResult>;
}

export interface HookContext {
  agentId?: string;
  agentType?: string;
  messages?: any[];
  toolName?: string;
  toolArgs?: Record<string, any>;
  result?: any;
  error?: string;
  signal?: AbortSignal;
}

export interface HookResult {
  allowed?: boolean;
  modifiedContent?: any;
  error?: string;
  additionalContexts?: string[];
}

export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in';
  baseDir: 'built-in';
  callback?: () => void;
  getSystemPrompt: (params: { toolUseContext: Pick<ToolUseContext, 'options'> }) => string;
}

export interface CustomAgentDefinition extends BaseAgentDefinition {
  getSystemPrompt: () => string;
  source: 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings';
  filename?: string;
  baseDir?: string;
}

export interface PluginAgentDefinition extends BaseAgentDefinition {
  getSystemPrompt: () => string;
  source: 'plugin';
  filename?: string;
  plugin: string;
}

export type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition;

export interface BaseAgentDefinition {
  agentType: string;
  whenToUse: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  mcpServers?: AgentMcpServerSpec[];
  hooks?: HooksSettings;
  color?: AgentColorName;
  model?: string;
  effort?: EffortValue;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  filename?: string;
  baseDir?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  requiredMcpServers?: string[];
  background?: boolean;
  initialPrompt?: string;
  memory?: AgentMemoryScope;
  isolation?: 'worktree' | 'remote';
  pendingSnapshotUpdate?: { snapshotTimestamp: string };
  omitClaudeMd?: boolean;
}

export type AgentMcpServerSpec =
  | string
  | { [name: string]: any };

export interface AgentToolResult {
  agentId: string;
  agentType?: string;
  content: Array<{ type: 'text'; text: string }>;
  totalToolUseCount: number;
  totalDurationMs: number;
  totalTokens: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    server_tool_use?: {
      web_search_requests: number;
      web_fetch_requests: number;
    } | null;
    service_tier?: 'standard' | 'priority' | 'batch' | null;
    cache_creation?: {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    } | null;
  };
}

export interface AgentToolInput {
  subagent_type?: string;
  prompt: string;
  model?: string;
  max_turns?: number;
  background?: boolean;
}

export interface AgentExecutionContext {
  agentDefinition?: AgentDefinition;
  prompt: string;
  model?: string;
  maxTurns?: number;
  context: {
    getAppState: () => any;
    setAppState: (updater: (prev: any) => any) => void;
    abortController: AbortController;
    options: {
      tools: Tools;
      mcpClients?: any[];
      isNonInteractiveSession?: boolean;
    };
  };
  availableTools: Tools;
  isAsync?: boolean;
  forkContextMessages?: any[];
}

export type { Tool, Tools, ToolUseContext };
export type { CoreMessage };