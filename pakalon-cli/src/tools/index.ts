/**
 * Tools module — consolidated exports for the in-process tool system.
 *
 * The AI agent uses src/ai/tools.ts (Vercel AI SDK format) for all tool calls.
 * This module provides the underlying implementations and utilities.
 */
export * from "./executor.js";
export { registerTool, getTool, getAllTools, getToolNames, getToolsByCategory, unregisterTool, clearRegistry, getToolMetadata } from "./registry.js";
export * from "./permissions.js";
export * from "./streaming.js";

// In-process tool implementations (used by ai/tools.ts)
export { executeBash, isSafeCommand, detectDangerousPatterns, isSelfKillCommand, getDestructiveWarnings } from "./bash.js";
export { ripgrepSearch, ripgrepGlob } from "./ripgrep.js";
export { askUserGate } from "./ask-user.js";
export { loadSkill, listSkills } from "./skills.js";
export * from "./component-url-import.js";
export * from "./design-verifier.js";
export * from "./wireframe-element-extractor.js";
export * from "./playwright-test-runner.js";

// PowerShell tool (Windows shell support)
export {
  executePowerShell,
  executePowerShellPty,
  isReadOnlyCommand as isPsReadOnlyCommand,
  detectDangerousPatterns as detectPsDangerousPatterns,
  hasSyncSecurityConcerns,
  isSelfKillCommand as isPsSelfKillCommand,
  detectBlockedSleepPattern,
  getPsSessionCwd,
  setPsSessionCwd,
  getPowerShellPath,
  getPowerShellEdition,
  getPowerShellPrompt,
  powerShellToolDefinition,
  powerShellToolSchema,
} from "./powershell.js";

// Team tools (multi-agent swarm coordination)
export {
  teamCreateToolDefinition,
  teamCreateSchema,
  createTeam,
  teamDeleteToolDefinition,
  teamDeleteSchema,
  deleteTeam,
  sendMessageToolDefinition,
  sendMessageSchema,
  sendMessage,
  readInbox,
  clearInbox,
  readTeamFile,
  writeTeamFile,
  addTeamMember,
  removeTeamMember,
  updateMemberStatus,
  listTeams,
  getTeamMembers,
  formatAgentId,
  parseAgentId,
  registerTeamForSessionCleanup,
  cleanupAllTeams,
} from "./team-tools.js";

// MCP Resource tools
export {
  listMcpResourcesToolDefinition,
  listMcpResourcesSchema,
  listMcpResources,
  readMcpResourceToolDefinition,
  readMcpResourceSchema,
  readMcpResource,
  invalidateResourceCache,
  persistBinaryContent,
} from "./mcp-resources.js";

// Advanced tools (Brief, Config, Sleep, Todo, ToolSearch, Cron)
export {
  briefToolSchema,
  briefToolDefinition,
  executeBriefTool,
  configToolSchema,
  configToolDefinition,
  executeConfigTool,
  sleepToolSchema,
  sleepToolDefinition,
  executeSleepTool,
  todoWriteToolSchema,
  todoWriteToolDefinition,
  executeTodoWriteTool,
  toolSearchToolSchema,
  toolSearchToolDefinition,
  executeToolSearchTool,
  scheduleCronToolSchema,
  scheduleCronToolDefinition,
  executeScheduleCronTool,
} from "./advanced-tools.js";

// REPL Tool (interactive code evaluation)
export {
  replToolSchema,
  replToolDefinition,
  executeREPLTool,
  createREPLContext,
  getREPLContext,
  deleteREPLContext,
  listREPLContexts,
} from "./repl-tool.js";

// Web Search Tool (multi-provider search)
export {
  webSearch,
  webSearchSchema,
  webSearchToolDefinition,
} from "./web-search.js";

// GitHub Filesystem Tool (pr:// and issue:// URL schemes)
export {
  readGitHubURL,
  readPR,
  readPRDiff,
  readPRFullDiff,
  readIssue,
  listIssues,
  parseGitHubURL,
  githubFSToolDefinition,
} from "./github-fs.js";

// AST Edit Tool (structural code rewrites)
export {
  astGrepSearch,
  astGrepReplace,
  stageChange,
  getStagedChange,
  applyStagedChange,
  discardStagedChange,
  clearStagedChanges,
  astEditToolDefinition,
  resolveToolDefinition,
} from "./ast-edit.js";

// Stream Rules Tool (time-traveling course correction)
export {
  StreamRuleManager,
  StreamInterceptor,
  DEFAULT_RULES,
  streamRuleToolDefinition,
} from "./stream-rules.js";

// IRC Tool (inter-agent communication)
export {
  IRCManager,
  getIRCManager,
  resetIRCManager,
  ircToolDefinition,
} from "./irc.js";

// Debug Tool (Debug Adapter Protocol)
export {
  DebugAdapter,
  debugToolDefinition,
} from "./debug.js";

// Hashline Tool (edit by content hash)
export {
  parseFile,
  parseContent,
  findLineByHash,
  findLinesByPattern,
  generateAnchor,
  parseAnchor,
  createEdit,
  validateEdit,
  applyEdit,
  applyEdits,
  generateDiff,
  formatDiff,
  hashlineToolDefinition,
} from "./hashline.js";

// ACP Tool (editor-drivable agent)
export {
  ACPServer,
  acpToolDefinition,
} from "./acp.js";

// Code Execution Tool (Python/Bun worker bridge)
export {
  CodeExecutionBridge,
  getCodeExecutionBridge,
  codeExecutionToolDefinition,
} from "./code-execution.js";

// Bundled Agents (7 pre-configured subagents)
export {
  AGENT_CONFIGS,
  AgentManager,
  getAgentManager,
  agentToolDefinition,
} from "./bundled-agents.js";

// Notebook Edit Tool (Jupyter notebook editing)
export {
  readNotebook,
  writeNotebook,
  createNotebook,
  addCell,
  updateCell,
  removeCell,
  moveCell,
  clearAllOutputs,
  notebookEditSchema,
  notebookEditToolDefinition,
  executeNotebookEdit,
} from "./notebook-edit.js";

// Imported Claude source tool modules (directory-based implementations)
export * from "./brief-tool/BriefTool.js";
export * from "./config-tool/ConfigTool.js";
export * from "./enter-plan-mode-tool/EnterPlanModeTool.js";
export * from "./exit-plan-mode-tool/ExitPlanModeV2Tool.js";
export * from "./enter-worktree-tool/EnterWorktreeTool.js";
export * from "./exit-worktree-tool/ExitWorktreeTool.js";
export * from "./list-mcp-resources-tool/ListMcpResourcesTool.js";
export * from "./mcp-auth-tool/McpAuthTool.js";
export * from "./read-mcp-resource-tool/ReadMcpResourceTool.js";
export * from "./remote-trigger-tool/RemoteTriggerTool.js";
export * from "./schedule-cron-tool/CronCreateTool.js";
export * from "./schedule-cron-tool/CronListTool.js";
export * from "./schedule-cron-tool/CronDeleteTool.js";
export * from "./synthetic-output-tool/SyntheticOutputTool.js";
export * from "./task-output-tool/TaskOutputTool.js";
export * from "./task-update-tool/TaskUpdateTool.js";
export * from "./todo-write-tool/TodoWriteTool.js";
export * from "./tool-search-tool/ToolSearchTool.js";
export * from "./team-create-tool/TeamCreateTool.js";
export * from "./team-delete-tool/TeamDeleteTool.js";
export * from "./send-message-tool/SendMessageTool.js";
export * from "./WorkflowTool/WorkflowTool.js";

// Enhanced Tool class with full lifecycle
export { Tool, buildTool, toolsToRecord } from "./tool.js";
export type { ToolLifecycleConfig, InterruptBehavior } from "./tool.js";

// Tool rendering and interrupt system
export {
  renderToolCallMessage,
  renderToolResultMessage,
  formatToolUse,
  formatToolResult,
  shouldInterruptTool,
  generateSearchReadSuggestion,
  applyContentReplacement,
  createContentReplacement,
} from "./toolRenderer.js";

// Content budget manager
export { ContentBudgetManager } from "./contentBudget.js";
export type { ContentBudgetConfig, ContentBudgetState, ToolResultEntry } from "./contentBudget.js";

// Tool confirmation and auto-approve
export { ConfirmationManager } from "./toolConfirmation.js";
export type { ConfirmationState, PendingConfirmation, ConfirmationConfig } from "./toolConfirmation.js";

// Skill-aware tool routing
export { SkillAwareRouter } from "./skillAwareRouter.js";
export type { SkillToolRules, SkillToolProfile, SkillAwareRoutingConfig } from "./skillAwareRouter.js";

// Web Browser Tool (Playwright-based browser automation)
export {
  browserNavigate,
  browserClick,
  browserFillForm,
  browserSnapshot,
  browserScreenshot,
  browserWait,
  browserSelectOption,
  browserClose,
  browserNavigateSchema,
  browserClickSchema,
  browserFillFormSchema,
  browserSnapshotSchema,
  browserScreenshotSchema,
  browserWaitSchema,
  browserSelectOptionSchema,
  browserNavigateToolDefinition,
  browserClickToolDefinition,
  browserFillFormToolDefinition,
  browserSnapshotToolDefinition,
  browserScreenshotToolDefinition,
  browserWaitToolDefinition,
  browserSelectOptionToolDefinition,
  browserCloseToolDefinition,
} from "./web-browser-tool.js";
export {
  BrowserAgent,
  overlayMarks,
  capturePageSnapshot,
  parseElementRefsFromSnapshot,
  browserAgentOptionsSchema,
  browserOpenSchema,
  browserSnapshotSchema,
  browserClickSchema,
  browserFillSchema,
  browserScreenshotSchema,
  browserCloseSchema,
} from "./browser-agent.js";
export * from "./monitor-tool/index.js";

// Curated web + product import tools
export {
  hoppscotch_send_request,
  hoppscotch_create_collection,
  hoppscotch_run_collection,
  hoppscotchSendRequest,
  hoppscotchCreateCollection,
  hoppscotchRunCollection,
} from "./hoppscotch.js";
export {
  figma_import_file,
  figma_import,
  figma_extract_components,
  figma_generate_design_doc,
  figmaImportFile,
  parseFigmaUrlOrKey,
  figmaExtractComponents,
  figmaGenerateDesignDoc,
} from "./figma-import.js";

// Video Analysis Tool
export { VideoAnalysisTool } from "./VideoAnalysisTool/index.js";

// Terminal Capture Tool
export * from "./TerminalCaptureTool/TerminalCaptureTool.js";

// Fork Tool (Subagent Fork)
export * from "./ForkTool/ForkTool.js";

// Buddy System Tool
export * from "./BuddyTool/BuddyTool.js";

// In-Process Teammate Tool
export * from "./InProcessTeammateTool/InProcessTeammateTool.js";

// In-Process Teammate Helpers
export * from "./utils/inProcessTeammateHelpers.js";

// Overflow Test Tool
export * from "./OverflowTestTool/OverflowTestTool.js";

// Context Inspect Tool
export * from "./CtxInspectTool/CtxInspectTool.js";

// Verify Plan Tool
export * from "./VerifyPlanTool/VerifyPlanTool.js";

// Send User File Tool
export * from "./SendUserFileTool/SendUserFileTool.js";

// Push Notification Tool
export * from "./PushNotificationTool/PushNotificationTool.js";

// Subscribe PR Tool
export * from "./SubscribePRTool/SubscribePRTool.js";

// List Peers Tool
export * from "./ListPeersTool/ListPeersTool.js";

// Component RAG Pipeline
export {
  searchComponents,
  indexComponentWebsites,
  type ComponentSource,
  type ComponentResult,
} from "./component-rag.js";

// Component Context Builder
export {
  buildComponentContext,
} from "./component-context-builder.js";

// Image Generation Tool
export {
  imageGenToolInputSchema,
  imageGenToolDefinition,
  executeImageGenTool,
  generateImage,
  type ImageGenOptions,
  type GeneratedImage,
  type ImageGenResult,
} from "./image-gen-tool.js";

// Sleep Tool (enhanced with interruption support)
export {
  sleepController,
  interruptSleep,
  interruptAllSleeps,
} from "./sleep-tool/SleepTool.js";

// Feature Flags (runtime feature gating)
export {
  feature,
  enableFeature,
  disableFeature,
  toggleFeature,
  isFeatureEnabled,
  getEnabledFeatures,
  getFeatureSource,
  saveFeatureFlags,
  resetFeatureFlags,
  configureFeatureFlags,
  loadRemoteFeatureFlags,
  type FeatureFlag,
} from "@/utils/features.js";

// Diagnostics Logging (PII-safe)
export {
  initDiagnostics,
  logForDiagnosticsNoPII,
  logDiagnosticInfo,
  logDiagnosticTiming,
  stripPII,
  getRecentDiagnostics,
  closeDiagnostics,
} from "@/utils/diagnostics.js";

// Agent Summarization
export {
  registerAgent,
  updateAgentProgress,
  setAgentActivity,
  startAgent,
  completeAgent,
  failAgent,
  getAgentProgress,
  getAllAgentProgress,
  getAgentSummary,
  onAgentProgress,
  cleanupAgentData,
} from "@/services/agent-summary.js";
