/**
 * Enhanced Tool Types
 *
 * Comprehensive type definitions for the tool system, matching the source Claude Code implementation.
 * Includes all missing methods like backfillObservableInput, preparePermissionMatcher,
 * renderToolUseMessage, etc.
 */

import { z } from 'zod';

// ============================================================================
// Core Types
// ============================================================================

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'auto'
  | 'bubble';

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; reason?: string }
  | { behavior: 'ask'; reason?: string };

export interface ToolPermissionContext {
  mode: PermissionMode;
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>;
  alwaysAllowRules: ToolPermissionRulesBySource;
  alwaysDenyRules: ToolPermissionRulesBySource;
  alwaysAskRules: ToolPermissionRulesBySource;
  isBypassPermissionsModeAvailable: boolean;
  isAutoModeAvailable?: boolean;
  strippedDangerousRules?: ToolPermissionRulesBySource;
  shouldAvoidPermissionPrompts?: boolean;
  awaitAutomatedChecksBeforeDialog?: boolean;
  prePlanMode?: PermissionMode;
}

export interface AdditionalWorkingDirectory {
  path: string;
  reason: string;
}

export interface ToolPermissionRulesBySource {
  cliArg?: string[];
  session?: string[];
  frontmatter?: string[];
  plugin?: string[];
}

export type ToolInputJSONSchema = {
  [x: string]: unknown;
  type: 'object';
  properties?: { [x: string]: unknown };
};

export type ValidationResult =
  | {
      result: true;
    }
  | {
      result: false;
      message: string;
      errorCode: number;
    };

// ============================================================================
// Progress Types
// ============================================================================

export interface ToolProgressData {
  type: string;
  [key: string]: unknown;
}

export interface BashProgress extends ToolProgressData {
  type: 'bash';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
}

export interface AgentToolProgress extends ToolProgressData {
  type: 'agent';
  agentType?: string;
  status?: 'running' | 'completed' | 'failed';
  message?: string;
}

export interface MCPProgress extends ToolProgressData {
  type: 'mcp';
  serverName?: string;
  toolName?: string;
  status?: 'connecting' | 'connected' | 'error';
}

export interface REPLToolProgress extends ToolProgressData {
  type: 'repl';
  output?: string;
  error?: string;
}

export interface SkillToolProgress extends ToolProgressData {
  type: 'skill';
  skillName?: string;
  status?: 'loading' | 'ready' | 'error';
}

export interface TaskOutputProgress extends ToolProgressData {
  type: 'task_output';
  taskId?: string;
  status?: 'running' | 'completed' | 'failed';
}

export interface WebSearchProgress extends ToolProgressData {
  type: 'web_search';
  query?: string;
  resultCount?: number;
}

export interface HookProgress extends ToolProgressData {
  type: 'hook_progress';
  hookName?: string;
  status?: 'running' | 'completed' | 'error';
  message?: string;
}

export type Progress = ToolProgressData | HookProgress;

export interface ToolProgress<P extends ToolProgressData = ToolProgressData> {
  toolUseID: string;
  data: P;
}

export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> = (
  progress: ToolProgress<P>,
) => void;

// ============================================================================
// Tool Result Types
// ============================================================================

export interface ToolResultBlockParam {
  type: 'content';
  content: Array<{
    type: 'text';
    text: string;
  } | {
    type: 'tool_use_block';
    id: string;
    name: string;
    input: Record<string, unknown>;
  } | {
    type: 'error';
    text: string;
  }>;
}

export interface ToolUseBlockParam {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ToolResult<T> = {
  data: T;
  newMessages?: Array<{
    type: 'user' | 'assistant' | 'attachment' | 'system';
    [key: string]: unknown;
  }>;
  contextModifier?: (context: ToolUseContext) => ToolUseContext;
  mcpMeta?: {
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
};

// ============================================================================
// Tool Use Context
// ============================================================================

export type CompactProgressEvent =
  | {
      type: 'hooks_start';
      hookType: 'pre_compact' | 'post_compact' | 'session_start';
    }
  | {
      type: 'compact_start';
    }
  | {
      type: 'compact_end';
    };

export interface ToolUseContext {
  options: {
    commands: Command[];
    debug: boolean;
    mainLoopModel: string;
    tools: Tools;
    verbose: boolean;
    thinkingConfig: ThinkingConfig;
    mcpClients: MCPServerConnection[];
    mcpResources: Record<string, ServerResource[]>;
    isNonInteractiveSession: boolean;
    agentDefinitions: AgentDefinitionsResult;
    maxBudgetUsd?: number;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    querySource?: QuerySource;
    refreshTools?: () => Tools;
  };
  abortController: AbortController;
  readFileState: FileStateCache;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  setAppStateForTasks?: (f: (prev: AppState) => AppState) => void;
  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>;
  setToolJSX?: SetToolJSXFn;
  addNotification?: (notif: Notification) => void;
  appendSystemMessage?: (msg: SystemMessage) => void;
  sendOSNotification?: (opts: { message: string; notificationType: string }) => void;
  nestedMemoryAttachmentTriggers?: Set<string>;
  loadedNestedMemoryPaths?: Set<string>;
  dynamicSkillDirTriggers?: Set<string>;
  discoveredSkillNames?: Set<string>;
  userModified?: boolean;
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void;
  setHasInterruptibleToolInProgress?: (v: boolean) => void;
  setResponseLength: (f: (prev: number) => number) => void;
  pushApiMetricsEntry?: (ttftMs: number) => void;
  setStreamMode?: (mode: SpinnerMode) => void;
  onCompactProgress?: (event: CompactProgressEvent) => void;
  setSDKStatus?: (status: SDKStatus) => void;
  openMessageSelector?: () => void;
  updateFileHistoryState: (updater: (prev: FileHistoryState) => FileHistoryState) => void;
  updateAttributionState: (updater: (prev: AttributionState) => AttributionState) => void;
  setConversationId?: (id: string) => void;
  agentId?: AgentId;
  agentType?: string;
  requireCanUseTool?: boolean;
  messages: Message[];
  fileReadingLimits?: {
    maxTokens?: number;
    maxSizeBytes?: number;
  };
  globLimits?: {
    maxResults?: number;
  };
  toolDecisions?: Map<
    string,
    {
      source: string;
      decision: 'accept' | 'reject';
      timestamp: number;
    }
  >;
  queryTracking?: QueryChainTracking;
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>;
  toolUseId?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  preserveToolUseResults?: boolean;
  localDenialTracking?: DenialTrackingState;
  contentReplacementState?: ContentReplacementState;
  renderedSystemPrompt?: SystemPrompt;
}

export type SetToolJSXFn = (args: {
  jsx: React.ReactNode | null;
  shouldHidePromptInput: boolean;
  shouldContinueAnimation?: true;
  showSpinner?: boolean;
  isLocalJSXCommand?: boolean;
  isImmediate?: boolean;
  clearLocalJSX?: boolean;
} | null) => void;

export interface Command {
  name: string;
  description?: string;
  aliases?: string[];
}

export interface ThinkingConfig {
  type: 'disabled' | 'slow' | 'ultraslow';
  budget?: number;
}

export interface MCPServerConnection {
  name: string;
  type: 'connected' | 'connecting' | 'error' | 'disconnected';
  tools?: Tool[];
  cleanup?: () => Promise<void>;
}

export interface ServerResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface AgentDefinitionsResult {
  agents: AgentDefinition[];
}

export interface AgentDefinition {
  agentType: string;
  description?: string;
  getSystemPrompt?: (context: { toolUseContext: ToolUseContext }) => Promise<string[]>;
  model?: string;
  maxTurns?: number;
  omitClaudeMd?: boolean;
  permissionMode?: PermissionMode;
  effort?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  skills?: string[];
  hooks?: HookDefinition[];
  mcpServers?: Array<string | Record<string, unknown>>;
  source?: string;
  callback?: () => void;
}

export interface HookDefinition {
  hookType: string;
  name: string;
  description?: string;
}

export interface AppState {
  toolPermissionContext: ToolPermissionContext;
  effortValue?: string;
  todos?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FileStateCache {
  has(path: string): boolean;
  get(path: string): FileState | undefined;
  set(path: string, state: FileState): void;
  delete(path: string): void;
  clear(): void;
}

export interface FileState {
  path: string;
  exists?: boolean;
  isDirectory?: boolean;
  size?: number;
  modified?: number;
}

export interface DenialTrackingState {
  denialCount: number;
  lastDenialTime?: number;
}

export interface ContentReplacementState {
  replacements: Map<string, ToolResultReplacement>;
}

export interface ToolResultReplacement {
  originalText: string;
  replacementText: string;
  toolUseId: string;
}

export interface SystemPrompt {
  systemPrompt: string[];
}

export interface FileHistoryState {
  files: Set<string>;
  lastAccessed?: Map<string, number>;
}

export interface AttributionState {
  commits: Map<string, CommitInfo>;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface QueryChainTracking {
  chainId: string;
  depth: number;
}

export interface PromptRequest {
  type: 'text' | 'select';
  message: string;
  options?: string[];
}

export interface PromptResponse {
  type: 'response';
  text?: string;
  selected?: string;
}

export interface Notification {
  type: string;
  title?: string;
  body?: string;
  timestamp?: number;
}

export interface ElicitRequestURLParams {
  url: string;
  title?: string;
  description?: string;
}

export interface ElicitResult {
  type: 'url';
  url: string;
}

export type SpinnerMode = 'dot' | 'line' | 'dots' | 'simple';

export interface SDKStatus {
  status: 'connected' | 'disconnected' | 'error';
  message?: string;
}

export interface Message {
  type: 'user' | 'assistant' | 'system' | 'progress' | 'attachment';
  uuid?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface AgentId {
  id: string;
}

// ============================================================================
// Enhanced Tool Interface
// ============================================================================

export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  /** Optional aliases for backwards compatibility when a tool is renamed */
  aliases?: string[];

  /** One-line capability phrase used by ToolSearch for keyword matching */
  searchHint?: string;

  call: (
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ) => Promise<ToolResult<Output>>;

  description: (
    input: z.infer<Input>,
    options: {
      isNonInteractiveSession: boolean;
      toolPermissionContext: ToolPermissionContext;
      tools: Tools;
    },
  ) => Promise<string>;

  readonly inputSchema: Input;
  readonly inputJSONSchema?: ToolInputJSONSchema;
  outputSchema?: z.ZodType<unknown>;

  inputsEquivalent?: (a: z.infer<Input>, b: z.infer<Input>) => boolean;

  isConcurrencySafe(input: z.infer<Input>): boolean;
  isEnabled(): boolean;
  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;

  interruptBehavior?(): 'cancel' | 'block';

  isSearchOrReadCommand?(input: z.infer<Input>): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  };

  isOpenWorld?(input: z.infer<Input>): boolean;
  requiresUserInteraction?(): boolean;
  isMcp?: boolean;
  isLsp?: boolean;

  readonly shouldDefer?: boolean;
  readonly alwaysLoad?: boolean;

  mcpInfo?: { serverName: string; toolName: string };

  readonly name: string;

  maxResultSizeChars: number;

  readonly strict?: boolean;

  /**
   * Called on copies of tool_use input before observers see it (SDK stream,
   * transcript, canUseTool, PreToolUse/PostToolUse hooks). Mutate in place
   * to add legacy/derived fields. Must be idempotent.
   */
  backfillObservableInput?(input: Record<string, unknown>): void;

  /**
   * Determines if this tool is allowed to run with this input in the current context.
   */
  validateInput?: (
    input: z.infer<Input>,
    context: ToolUseContext,
  ) => Promise<ValidationResult>;

  /**
   * Determines if the user is asked for permission.
   */
  checkPermissions: (
    input: z.infer<Input>,
    context: ToolUseContext,
  ) => Promise<PermissionResult>;

  getPath?(input: z.infer<Input>): string;

  /**
   * Prepare a matcher for hook `if` conditions
   */
  preparePermissionMatcher?: (
    input: z.infer<Input>,
  ) => Promise<(pattern: string) => boolean>;

  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>;
    tools: Tools;
    agents: AgentDefinition[];
    allowedAgentTypes?: string[];
  }): Promise<string>;

  userFacingName(input: Partial<z.infer<Input>> | undefined): string;
  userFacingNameBackgroundColor?(input: Partial<z.infer<Input>> | undefined): keyof Theme | undefined;
  isTransparentWrapper?(): boolean;

  getToolUseSummary?(input: Partial<z.infer<Input>> | undefined): string | null;

  getActivityDescription?(input: Partial<z.infer<Input>> | undefined): string | null;

  toAutoClassifierInput(input: z.infer<Input>): unknown;

  mapToolResultToToolResultBlockParam: (
    content: Output,
    toolUseID: string,
  ) => ToolResultBlockParam;

  renderToolResultMessage?: (
    content: Output,
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      style?: 'condensed';
      theme: ThemeName;
      tools: Tools;
      verbose: boolean;
      isTranscriptMode?: boolean;
      isBriefOnly?: boolean;
      input?: unknown;
    },
  ) => React.ReactNode;

  extractSearchText?(out: Output): string;

  renderToolUseMessage: (
    input: Partial<z.infer<Input>>,
    options: {
      theme: ThemeName;
      verbose: boolean;
      commands?: Command[];
    },
  ) => React.ReactNode;

  isResultTruncated?(output: Output): boolean;

  renderToolUseTag?(input: Partial<z.infer<Input>>): React.ReactNode;

  renderToolUseProgressMessage?: (
    progressMessagesForMessage: ProgressMessage<P>[],
    options: {
      tools: Tools;
      verbose: boolean;
      terminalSize?: { columns: number; rows: number };
      inProgressToolCallCount?: number;
      isTranscriptMode?: boolean;
    },
  ) => React.ReactNode;

  renderToolUseQueuedMessage?(): React.ReactNode;

  renderToolUseRejectedMessage?: (
    input: z.infer<Input>,
    options: {
      columns: number;
      messages: Message[];
      style?: 'condensed';
      theme: ThemeName;
      tools: Tools;
      verbose: boolean;
      progressMessagesForMessage: ProgressMessage<P>[];
      isTranscriptMode?: boolean;
    },
  ) => React.ReactNode;

  renderToolUseErrorMessage?: (
    result: ToolResultBlockParam['content'],
    options: {
      progressMessagesForMessage: ProgressMessage<P>[];
      tools: Tools;
      verbose: boolean;
      isTranscriptMode?: boolean;
    },
  ) => React.ReactNode;

  renderGroupedToolUse?: (
    toolUses: Array<{
      param: ToolUseBlockParam;
      isResolved: boolean;
      isError: boolean;
      isInProgress: boolean;
      progressMessages: ProgressMessage<P>[];
      result?: { param: ToolResultBlockParam; output: unknown };
    }>,
    options: {
      shouldAnimate: boolean;
      tools: Tools;
    },
  ) => React.ReactNode | null;
};

export type Tools = readonly Tool[];

export type AnyObject = z.ZodType<{ [key: string]: unknown }>;

export type Theme = 'blue' | 'cyan' | 'green' | 'magenta' | 'red' | 'white' | 'yellow' | 'gray' | 'black';
export type ThemeName = 'light' | 'dark' | 'system';

export interface AssistantMessage {
  type: 'assistant';
  uuid: string;
  timestamp: number;
  message: {
    role: 'assistant';
    content: Array<unknown>;
  };
}

export interface ProgressMessage<P extends ToolProgressData = ToolProgressData> {
  type: 'progress';
  data: P;
  toolUseId?: string;
}

// ============================================================================
// CanUseTool Type
// ============================================================================

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  context: ToolUseContext,
) => Promise<PermissionResult>;

// ============================================================================
// Query Source
// ============================================================================

export type QuerySource =
  | 'agent:builtin:general-purpose'
  | 'agent:builtin:explore'
  | 'agent:builtin:plan'
  | 'agent:builtin:verification'
  | 'agent:builtin:fork'
  | 'agent:builtin:claude-code-guide'
  | 'agent:builtin:statusline-setup'
  | 'agent:custom'
  | 'repl'
  | 'sdk'
  | 'web'
  | 'compact'
  | 'agent:coordinator'
  | 'agent:worker';

// ============================================================================
// Tool Defaults
// ============================================================================

export interface ToolDefaults {
  isEnabled: () => boolean;
  isConcurrencySafe: (input: unknown) => boolean;
  isReadOnly: (input: unknown) => boolean;
  isDestructive: (input: unknown) => boolean;
  checkPermissions: (
    input: Record<string, unknown>,
    context?: ToolUseContext,
  ) => Promise<PermissionResult>;
  toAutoClassifierInput: (input: unknown) => unknown;
  userFacingName: (input: unknown) => string;
}

export const TOOL_DEFAULTS: ToolDefaults = {
  isEnabled: () => true,
  isConcurrencySafe: (_input) => false,
  isReadOnly: (_input) => false,
  isDestructive: (_input) => false,
  checkPermissions: (input) => Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: () => '',
  userFacingName: () => '',
};

// ============================================================================
// Build Tool Helper
// ============================================================================

export type ToolDef<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<Tool<Input, Output, P>, keyof ToolDefaults> & Partial<Pick<Tool<Input, Output, P>, keyof ToolDefaults>>;

type BuiltTool<D> = Omit<D, keyof ToolDefaults> & {
  [K in keyof ToolDefaults]-?: undefined extends D[K] ? ToolDefaults[K] : D[K];
};

export function buildTool<D extends ToolDef>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  } as BuiltTool<D>;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find(t => toolMatchesName(t, name));
}

export function filterToolProgressMessages(
  progressMessagesForMessage: ProgressMessage[],
): ProgressMessage<ToolProgressData>[] {
  return progressMessagesForMessage.filter(
    (msg): msg is ProgressMessage<ToolProgressData> =>
      msg.data?.type !== 'hook_progress',
  );
}

// ============================================================================
// Permission Mode Helpers
// ============================================================================

export function isPermissionModeAllowed(mode: PermissionMode): boolean {
  return mode !== 'default';
}

export function getDefaultPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  };
}

// ============================================================================
// React Node Type (for UI rendering)
// ============================================================================

declare global {
  namespace React {
    type Node = import('react').ReactNode;
  }
}
