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

export { SessionManager, sessionManager };

// Re-export SessionStore interface
export type { SessionStore } from './types.js';
