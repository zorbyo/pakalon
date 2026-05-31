/**
 * Session Management Module
 * 
 * Complete session management implementation including:
 * - Session persistence (save/restore to disk)
 * - Session resume (recover conversations after interruption)
 * - Session title generation
 * - Session state management
 * - File state cache for subagent context
 * - File persistence for tool result storage
 */

// Types
export * from './types.js';

// Session Storage
export {
  sessionStorage,
  SessionStorage,
  getSessionDir,
  getProjectsDir,
  getProjectDir,
  getTranscriptPath,
  getAgentTranscriptPath,
  getAgentMetadataPath,
  isTranscriptMessage,
  isChainParticipant,
} from './sessionStorage.js';

// Conversation Recovery
export {
  loadConversationForResume,
  createResumeData,
  listRecentSessions,
  searchSessions,
  detectTurnInterruption,
  deserializeMessages,
  extractConversationText,
  checkResumeConsistency,
  loadMessagesFromTranscript,
  restoreSkillStateFromMessages,
} from './conversationRecovery.js';

// Session Title
export {
  generateSessionTitle,
  generateTitleFromMessages,
  isValidTitle,
  sanitizeTitle,
  extractTitleFromFirstMessage,
} from './sessionTitle.js';

// Session State
export {
  getSessionState,
  getPermissionMode,
  notifySessionStateChanged,
  notifySessionMetadataChanged,
  notifyPermissionModeChanged,
  setSessionStateChangedListener,
  setSessionMetadataChangedListener,
  setPermissionModeChangedListener,
  resetSessionState,
  isTerminalState,
  isRequiresActionState,
  isRunningState,
  getExternalMetadata,
  createRequiresActionDetails,
  isValidPermissionMode,
  getDefaultPermissionMode,
} from './sessionState.js';

// Bootstrap State (session ID, cwd, project root)
export { getSessionId, setSessionId, getOriginalCwd, setOriginalCwd, getProjectRoot, setProjectRoot } from '../bootstrap/state.js';

// File State Cache
export {
  FileStateCache,
  fileStateCache,
  getFileState,
  setFileState,
  invalidateFileState,
  clearFileStateCache,
  createFileStateCache,
  cloneFileStateCache,
  cacheToObject,
  cacheKeys,
} from './fileStateCache.js';

// File Persistence
export {
  initFilePersistence,
  recordFileChange,
  getFileHistory,
  getOriginalContent,
  getPreviousVersion,
  revertToVersion,
  clearFileHistory,
  getAllHistory,
  getSessionHistory,
  getPersistenceStats,
  enableFilePersistence,
  disableFilePersistence,
  isFilePersistenceEnabled,
  runFilePersistence,
  isFilePersistenceAvailable,
} from './filePersistence.js';

// Re-export SessionManager from original implementation for compatibility
import { SessionManager, sessionManager } from './sessionManager.js';

// Tree-based session branching
export * from './tree-session.js';

// Session Summary (diff tracking)
export { sessionSummaryService, SessionSummaryService } from './sessionSummary.js';
export type { SessionSummary, FileDiff, DiffResult } from './sessionSummary.js';

// Session Overflow Detection
export { calculateUsableTokens, isOverflow, getOverflowStatus, getOverflowPercentage, COMPACTION_BUFFER } from './sessionOverflow.js';
export type { OverflowConfig, OverflowResult } from './sessionOverflow.js';

// Session Retry Logic
export { calculateDelay, isRetryable, createRetryPolicy, withRetry, RETRY_INITIAL_DELAY, RETRY_BACKOFF_FACTOR, RETRY_MAX_DELAY_NO_HEADERS, RETRY_MAX_DELAY, RETRY_MAX_ATTEMPTS } from './sessionRetry.js';
export type { RetryError, RetryResult, RetryPolicy } from './sessionRetry.js';

// Session Instructions
export { findInstructionFiles, readInstructionFiles, getSystemInstructions, resolveNearbyInstructions, clearInstructionCache, INSTRUCTION_FILES, GLOBAL_INSTRUCTION_DIRS } from './sessionInstructions.js';
export type { InstructionFile, InstructionResult } from './sessionInstructions.js';

export { SessionManager, sessionManager };

// Re-export SessionStore interface
export type { SessionStore } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Session Features (from harness.md implementation)
// ─────────────────────────────────────────────────────────────────────────────

// Typed Errors
export {
  // Result type
  type Result,
  ok,
  err,
  getOrThrow,
  getOrUndefined,
  toError,
  
  // Error classes
  FileError,
  ExecutionError,
  SessionError,
  CompactionError,
  BranchSummaryError,
  AgentHarnessError,
  
  // Error codes
  type FileErrorCode,
  type ExecutionErrorCode,
  type SessionErrorCode,
  type CompactionErrorCode,
  type BranchSummaryErrorCode,
  type AgentHarnessErrorCode,
  
  // Normalization helpers
  normalizeHarnessError,
  normalizeHookError,
} from './errors.js';

// JSONL Storage
export {
  JsonlSessionStorage,
  loadJsonlSessionMetadata,
  PendingWriteQueue,
  type SessionHeader,
  type SessionTreeEntryBase,
  type MessageEntry,
  type ThinkingLevelChangeEntry,
  type ModelChangeEntry,
  type CompactionEntry,
  type BranchSummaryEntry,
  type CustomEntry,
  type CustomMessageEntry,
  type LabelEntry,
  type SessionInfoEntry,
  type LeafEntry,
  type SessionTreeEntry,
  type JsonlSessionMetadata,
  type SessionContext,
  type PendingWriteType,
  type PendingSessionWrite,
} from './jsonl-storage.js';

// Session Repository
export {
  SessionRepo,
  type SessionCreateOptions,
  type SessionListOptions,
  type SessionForkOptions,
} from './session-repo.js';

// Tree Navigation
export {
  TreeNavigator,
  type TreePreparation,
  type NavigateTreeResult,
  type BranchSummaryOptions,
  type BranchSummaryResult,
} from './tree-navigation.js';

// Advanced Features
export {
  // Thinking budgets
  DEFAULT_THINKING_BUDGETS,
  getThinkingBudget,
  type ThinkingBudgets,
  
  // Prompt templates
  formatPromptTemplateInvocation,
  type PromptTemplate,
  
  // Skills
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
  type Skill,
  
  // Resource management
  ResourceManager,
  type ResourceProvenance,
  
  // Session summary
  calculateSessionSummary,
  type SessionSummary,
} from './advanced-features.js';

// Enhanced AgentHarness
export {
  AgentHarnessEnhanced,
  createEnhancedAgentHarness,
  type AgentHarnessPhase,
  type ThinkingLevel,
  type ToolExecutionMode,
  type QueueMode,
  type StreamFn,
  type ModelConfig,
  type StreamContext,
  type StreamOptions,
  type StreamChunk,
  type AgentMessage,
  type ToolCall,
  type AgentTool,
  type ToolUseContext,
  type ToolResult,
  type StreamOptionsPatch,
  type LifecycleEvent,
  type Skill as AgentSkill,
  type PromptTemplate as AgentPromptTemplate,
  type AgentHarnessResources,
  type BeforeProviderRequestResult,
  type BeforeProviderPayloadResult,
  type ToolCallResult,
  type ToolResultPatch,
  type AbortResult,
  type TurnSnapshot,
} from '../engine/AgentHarnessEnhanced.js';

// Session Facade
export {
  SessionFacade,
  createSessionFacade,
  type SessionFacadeReadOptions,
  type SessionFacadeWriteOptions,
} from './session-facade.js';

// Enhanced Compaction
export {
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
  generateCompactionSummary,
  collectEntriesForBranchSummary,
  generateBranchSummary,
  type CompactionSettings,
  type CompactionPreparation,
  type FileOperations,
  type CompactResult,
  type SessionBeforeCompactEvent,
  type SessionCompactEvent,
  type SessionBeforeCompactResult,
  type BranchSummaryOptions,
  type BranchSummaryResult,
} from './compaction-enhanced.js';

// Durable Harness Recovery
export {
  DurableHarness,
  createDurableHarness,
  DEFAULT_DURABLE_HARNESS_CONFIG,
  type DurableHarnessConfig,
  type RecoveryContext,
  type RecoveryResult,
  type OperationType,
  type DurableEntry,
} from './durable-harness.js';

// Provider Hooks
export {
  ProviderHooksManager,
  providerHooks,
  type ProviderRequestContext,
  type StreamOptions,
  type StreamOptionsPatch,
  type ProviderRequestResult,
  type ProviderPayloadContext,
  type ProviderPayloadResult,
  type ProviderResponseContext,
  type ProviderHookType,
  type ProviderHookEvent,
  type ProviderHookHandler,
} from './provider-hooks.js';

// Turn Snapshot System
export {
  TurnSnapshotManager,
  turnSnapshotManager,
  compareSnapshots,
  type TurnSnapshot,
  type TurnSnapshotOptions,
  type SnapshotDiff,
} from './turn-snapshot.js';

// Pending Write Queue
export {
  PendingWriteQueue,
  WriteQueueFlushHandler,
  createPendingWriteQueue,
  createWriteQueueFlushHandler,
  DEFAULT_PENDING_WRITE_CONFIG,
  type PendingWriteType,
  type PendingSessionWrite,
  type PendingWriteQueueConfig,
} from './pending-write-queue.js';

// Session Export to HTML
export {
  SessionHtmlExporter,
  exportSessionToHtml,
  type ExportOptions,
} from './export-html.js';

// Session Share via GitHub Gist
export {
  SessionGistSharer,
  shareSessionAsGist,
  type ShareOptions,
  type ShareResult,
} from './share-gist.js';
