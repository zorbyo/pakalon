export * from './types.js';
export * from './constants.js';
export * from './taskId.js';

export * from './builtInAgents.js';
export * from './built-in/generalPurposeAgent.js';
export * from './built-in/exploreAgent.js';
export * from './built-in/planAgent.js';
export * from './built-in/verificationAgent.js';

export * from './agentColorManager.js';
export * from './agentMemory.js';
export * from './agentMemorySnapshot.js';
export * from './agentToolUtils.js';
export * from './loadAgents.js';
export * from './prompt.js';
export * from './forkSubagent.js';
export * from './runAgent.js';

export {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  VERIFICATION_AGENT_TYPE,
  ONE_SHOT_BUILTIN_AGENT_TYPES,
  ASYNC_AGENT_ALLOWED_TOOLS,
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
  AGENT_COLORS,
  FORK_SUBAGENT_TYPE,
  FORK_BOILERPLATE_TAG,
  FORK_DIRECTIVE_PREFIX,
} from './constants.js';

export {
  getBuiltInAgents,
  getBuiltInAgent,
  clearBuiltInAgentsCache,
  GENERAL_PURPOSE_AGENT,
  EXPLORE_AGENT,
  PLAN_AGENT,
  VERIFICATION_AGENT,
} from './builtInAgents.js';

export {
  setAgentColor,
  getAgentColor,
  getOrAssignAgentColor,
  getAllAgentColors,
  clearAgentColors,
  getAgentColorCSS,
  getAgentThemeColor,
} from './agentColorManager.js';

export {
  getAgentMemoryDir,
  isAgentMemoryPath,
  getAgentMemoryEntrypoint,
  getMemoryScopeDisplay,
  loadAgentMemoryPrompt,
  saveAgentMemory,
  ensureMemoryDirExists,
  getAgentMemoryFiles,
  clearAgentMemory,
} from './agentMemory.js';

export {
  checkAgentMemorySnapshot,
  initializeFromSnapshot,
  replaceFromSnapshot,
  markSnapshotSynced,
} from './agentMemorySnapshot.js';

export {
  filterToolsForAgent,
  resolveAgentTools,
  countToolUses,
  getLastToolUseName,
  extractTextContent,
  extractPartialResult,
  hasRequiredMcpServers,
  filterAgentsByMcpRequirements,
} from './agentToolUtils.js';

export {
  getAgentDefinitions,
  getAgentDefinition,
  getActiveAgentsFromList,
  loadAgentsFromDirectory,
  clearAgentDefinitionsCache,
} from './loadAgents.js';

export { getPrompt, getAgentSystemPrompt, formatAgentLine } from './prompt.js';

export {
  isForkSubagentEnabled,
  FORK_AGENT,
  isInForkChild,
  buildForkedMessages,
  buildChildMessage,
  buildWorktreeNotice,
} from './forkSubagent.js';

export {
  spawnAgent,
  stopAgent,
  getAgentStatus,
  getAgentOutput,
  getSpawnedAgent,
  getAllSpawnedAgents,
  getSpawnedAgentsByTeam,
  registerAgentProgressCallback,
  unregisterAgentProgressCallback,
  clearAllAgents,
  clearTeamAgents,
  getAgentMessages,
  addAgentMessage,
  filterIncompleteToolCalls,
  runAgentStreaming,
} from './runAgent.js';

export {
  registerAsyncAgent,
  unregisterAsyncAgent,
  updateAgentProgress,
  updateAgentSummary,
  completeAsyncAgent,
  failAsyncAgent,
  killAsyncAgent,
  getActiveAsyncAgents,
  getAsyncAgent,
  getTokenCountFromTracker,
  getProgressUpdate,
  updateProgressFromMessage,
  startAgentSummarization,
  runAsyncAgentLifecycle,
  getAutoBackgroundMs,
  shouldAutoBackground,
  createBackgroundRacePromise,
  getAllAsyncAgents,
  clearFinishedAsyncAgents,
} from './asyncAgentLifecycle.js';

export type { AsyncAgentTask, AgentLifecycleOptions } from './asyncAgentLifecycle.js';

export type {
  AgentDefinition,
  BuiltInAgentDefinition,
  CustomAgentDefinition,
  PluginAgentDefinition,
  BaseAgentDefinition,
  AgentToolInput,
  AgentToolResult,
  SpawnedAgent,
  AgentContext,
  AgentMessage,
  AgentProgress,
  AgentToolOptions,
  ResolvedAgentTools,
  AgentDefinitionsResult,
  AgentMcpServerSpec,
  AgentHooksSettings,
  EffortValue,
  AgentMemoryScope,
  AgentIsolation,
  AgentSource,
  PermissionMode,
  QuerySource,
  ToolActivity,
} from './types.js';

export type { FinalizeAgentToolMetadata } from './agentToolUtils.js';

export type { TaskType, TaskStatus, TaskStateBase } from './taskId.js';