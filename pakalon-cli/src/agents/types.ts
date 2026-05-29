export type AgentColorName =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'cyan';

export type AgentMemoryScope = 'user' | 'project' | 'local';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto' | 'bubble';

export type EffortValue = 'minimum' | 'low' | 'medium' | 'high' | 'maximum';

export type AgentIsolation = 'worktree' | 'remote';

export interface RemoteIsolationConfig {
  url?: string;
  authToken?: string;
  containerImage?: string;
  workspaceName?: string;
}

export type AgentSource = 'built-in' | 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' | 'plugin';

export type QuerySource =
  | 'agent:builtin:general-purpose'
  | 'agent:builtin:Explore'
  | 'agent:builtin:Plan'
  | 'agent:builtin:verification'
  | 'agent:builtin:fork'
  | 'agent:custom'
  | 'repl'
  | 'sdk'
  | 'web'
  | 'compact';

export interface AgentMcpServerSpec {
  type: 'reference' | 'inline';
  server: string;
  config?: Record<string, unknown>;
}

export interface AgentHooksSettings {
  preToolUse?: string;
  postToolUse?: string;
  preCompact?: string;
  postCompact?: string;
  permissionRequest?: string;
  permissionDenied?: string;
  postSampling?: string;
  stop?: string;
  sessionStart?: string;
}

export interface BaseAgentDefinition {
  agentType: string;
  description?: string;
  whenToUse?: string;
  tools?: string[];
  disallowedTools?: string[];
  allowedTools?: string[];
  skills?: string[];
  mcpServers?: AgentMcpServerSpec[];
  hooks?: AgentHooksSettings;
  color?: AgentColorName;
  model?: string;
  effort?: EffortValue;
  permissionMode?: PermissionMode;
  maxTurns?: number;
  memory?: AgentMemoryScope;
  background?: boolean;
  isolation?: AgentIsolation;
  remoteIsolation?: RemoteIsolationConfig;
  omitClaudeMd?: boolean;
  readOnly?: boolean;
  initialPrompt?: string;
  baseDir?: string;
  filename?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  requiredMcpServers?: string[];
  pendingSnapshotUpdate?: { snapshotTimestamp: string };
  source?: AgentSource;
}

export interface BuiltInAgentDefinition extends BaseAgentDefinition {
  source: 'built-in';
  baseDir: 'built-in';
  callback?: () => void;
  getSystemPrompt?: (params: { toolUseContext?: { options?: Record<string, unknown> } }) => string;
}

export interface CustomAgentDefinition extends BaseAgentDefinition {
  source: 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings';
  baseDir?: string;
  path?: string;
}

export interface PluginAgentDefinition extends BaseAgentDefinition {
  source: 'plugin';
  pluginId?: string;
  path?: string;
}

export type AgentDefinition = BuiltInAgentDefinition | CustomAgentDefinition | PluginAgentDefinition;

export interface AgentToolInput {
  description?: string;
  prompt: string;
  subagent_type?: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  run_in_background?: boolean;
  name?: string;
  team_name?: string;
  mode?: PermissionMode;
  isolation?: AgentIsolation;
  cwd?: string;
  tools?: string[];
  maxTurns?: number;
}

export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: Date;
}

export interface ToolResultEvent {
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
  timestamp: Date;
  duration: number;
}

export interface AgentConfig {
  name: string;
  model: string;
  systemPrompt: string;
  tools: unknown[] | Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onTextDelta?: (text: string) => void;
  onComplete?: (text: string) => void;
  onFeedback?: (feedback: {
    source: string;
    criticalIssues: number;
    highIssues: number;
    issues: Phase4State['securityIssues'];
    summary: string;
  }) => void;
}

export interface AgentResult {
  success: boolean;
  message: string;
  duration: number;
  filesCreated?: string[];
  data?: Record<string, unknown>;
}

// Extended AgentContext with fields used by phase agents
export interface AgentContext {
  agentId: string;
  agentName: string;
  agentType: string;
  userPrompt?: string;
  projectDir?: string;
  isYolo?: boolean;
  isAgentMode?: boolean;
  apiKey?: string;
  teamName?: string;
  parentAgentId?: string;
  permissionMode: PermissionMode;
  tools: string[];
  disallowedTools: string[];
  model?: string;
  maxTurns?: number;
  memory?: AgentMemoryScope;
  background: boolean;
  isolation?: AgentIsolation;
  cwd?: string;
  figmaFileId?: string;
  targetUrl?: string;
  deployTarget?: string;
  continuousMonitoring?: boolean;
}

// Phase 1 State
export interface Phase1State {
  userPrompt: string;
  projectDir: string;
  isYolo: boolean;
  isNewProject: boolean;
  researchContext: string;
  existingCodebaseSummary: string;
  qaAnswers: Map<string, string>;
  contextBudget: Record<string, number>;
  generatedFiles: Map<string, string>;
  skillsMd: string;
  totalContext: number;
  selections: Record<string, string>;
  questions: Array<{ key: string; prompt: string; options: string[]; default: string }>;
}

// Phase 2 State
export interface Phase2State {
  userPrompt: string;
  projectDir: string;
  figmaFileId?: string;
  figmaData?: unknown;
  penpotFileId?: string;
  wireframes: Array<{ name: string; penpotFileId: string; components: unknown[] }>;
  components: Array<{ name: string; description: string; type: string; props: Record<string, string> }>;
  designSystem: Record<string, unknown>;
}

// Phase 3 State
export interface Phase3State {
  userPrompt: string;
  projectDir: string;
  tasksCompleted: string[];
  tasksFailed: string[];
  codeGenerated: string[];
  subAgentResults: Map<string, AgentResult>;
  startTime?: number;
}

// Phase 4 State
export interface Phase4State {
  userPrompt: string;
  projectDir: string;
  securityIssues: Array<{
    tool: string;
    severity: string;
    file: string;
    line?: number;
    message: string;
    rule?: string;
  }>;
  scanResults: Map<string, { issues: number; error?: string; skipped?: boolean }>;
  targetUrl?: string;
}

// Phase 5 State
export interface Phase5State {
  userPrompt: string;
  projectDir: string;
  deploymentConfigs: string[];
  cicdPipelines: string[];
  deploymentUrl?: string;
  deployTarget?: string;
  sequentialAgents?: boolean;
}

// Phase 6 State
export interface Phase6State {
  userPrompt: string;
  projectDir: string;
  docsGenerated: string[];
  routes: string[];
  readmeGenerated: boolean;
  apiDocGenerated: boolean;
  changelogGenerated: boolean;
  modifiedFiles?: string[];
  translatedDocs?: string[];
  autoAddComments?: boolean;
}

export interface AgentToolResult {
  success: boolean;
  output?: string;
  error?: string;
  agentId?: string;
  agentName?: string;
  teamName?: string;
  background?: boolean;
  agentType?: string;
  totalToolUseCount?: number;
  totalDurationMs?: number;
  totalTokens?: number;
}

export interface SpawnedAgent {
  id: string;
  name: string;
  type: string;
  teamName?: string;
  model?: string;
  permissionMode?: PermissionMode;
  cwd?: string;
  background: boolean;
  isolation?: AgentIsolation;
  createdAt: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  result?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  content: string;
  agentId?: string;
  timestamp: string;
}

export interface ToolActivity {
  toolName: string;
  input?: Record<string, unknown>;
  activityDescription?: string;
  isSearch?: boolean;
  isRead?: boolean;
}

export interface AgentProgress {
  agentId: string;
  agentName?: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'stopped';
  progress?: number;
  message?: string;
  output?: string;
  error?: string;
  toolUseCount?: number;
  tokenCount?: number;
  lastActivity?: ToolActivity;
  recentActivities?: ToolActivity[];
  summary?: string;
  lastToolName?: string;
}

export interface AgentStatus {
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
  progress: number;
  eta?: string;
  message?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface DependencyConflict {
  packageName: string;
  currentVersion?: string;
  requiredVersion?: string;
  lockfileVersion?: string;
  type: 'direct' | 'peer' | 'duplicate';
  resolution: 'upgrade' | 'downgrade' | 'peer-fix' | 'manual';
  details: string;
}

export interface ConflictReport {
  projectDir: string;
  lockfilePath?: string;
  conflicts: DependencyConflict[];
  applied: string[];
  suggestions: string[];
  safeResolutions: string[];
  hasCritical: boolean;
}

export interface AgentToolOptions {
  input: AgentToolInput;
  context: AgentContext;
  canUseTool?: (toolName: string) => boolean;
  toolUseContext?: {
    abortController?: AbortController;
    options?: Record<string, unknown>;
  };
}

export interface ResolvedAgentTools {
  hasWildcard: boolean;
  validTools: string[];
  invalidTools: string[];
  resolvedTools: string[];
  allowedAgentTypes?: string[];
}

export interface AgentDefinitionsResult {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
  failedFiles?: Array<{ path: string; error: string }>;
  allowedAgentTypes?: string[];
}

export function isBuiltInAgent(agent: AgentDefinition): agent is BuiltInAgentDefinition {
  return agent.source === 'built-in';
}

export function isCustomAgent(agent: AgentDefinition): agent is CustomAgentDefinition {
  return agent.source !== 'built-in' && agent.source !== 'plugin';
}

export function isPluginAgent(agent: AgentDefinition): agent is PluginAgentDefinition {
  return agent.source === 'plugin';
}
