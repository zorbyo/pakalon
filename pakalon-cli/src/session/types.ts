/**
 * Session Management Type Definitions
 * 
 * Core types for session persistence, state management, and conversation recovery.
 */

import type { UUID } from 'crypto';
import type { SessionId, AgentId } from '../types-imported/ids.js';

/**
 * Core message type for session management
 * Simplified version that works across the application
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | Array<{ type: string; text?: string }>;
  metadata?: Record<string, unknown>;
  name?: string;
}

/**
 * Alias for SessionMessage for backward compatibility
 */
export type CoreMessage = SessionMessage;

/**
 * Session states
 */
export type SessionState = 'idle' | 'running' | 'requires_action';

/**
 * Session mode for coordinator vs normal detection
 */
export type SessionMode = 'coordinator' | 'normal';

/**
 * Metadata stored in session file header
 */
export interface SessionMetadata {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  model?: string;
  permissionMode?: string;
  workingDirectory?: string;
  turnCount?: number;
  tokenCount?: number;
  tags?: string[];
  archived?: boolean;
  agentName?: string;
  agentColor?: string;
  agentSetting?: string;
  mode?: SessionMode;
  firstPrompt?: string;
}

/**
 * Session data with messages and context
 */
export interface SessionData {
  metadata: SessionMetadata;
  messages: SessionMessage[];
  context?: SessionContext;
  state?: Record<string, unknown>;
}

/**
 * Session context for environment state
 */
export interface SessionContext {
  cwd?: string;
  branch?: string;
  claudeMdPath?: string;
  gitBranch?: string;
  slug?: string;
}

/**
 * Session store interface for persistence
 */
export interface SessionStore {
  save(session: SessionData): Promise<void>;
  load(id: string): Promise<SessionData | null>;
  list(filter?: SessionListFilter): Promise<SessionMetadata[]>;
  delete(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  archive?(id: string): Promise<boolean>;
}

/**
 * Filter options for listing sessions
 */
export interface SessionListFilter {
  archived?: boolean;
  limit?: number;
  offset?: number;
  searchQuery?: string;
}

/**
 * Turn interruption state for conversation recovery
 */
export type TurnInterruptionState =
  | { kind: 'none' }
  | { kind: 'interrupted_prompt'; message: SessionMessage }
  | { kind: 'interrupted_turn' };

/**
 * Deserialized conversation result
 */
export interface ConversationLoadResult {
  messages: SessionMessage[];
  turnInterruptionState: TurnInterruptionState;
  sessionId?: UUID;
  metadata?: SessionMetadata;
  fullPath?: string;
}

/**
 * Session resume data
 */
export interface SessionResumeData {
  sessionId: string;
  messages: SessionMessage[];
  state: Record<string, unknown>;
  metadata: SessionMetadata;
  turnInterruptionState: TurnInterruptionState;
}

/**
 * Session file entry types
 */
export type SessionEntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'custom-title'
  | 'ai-title'
  | 'last-prompt'
  | 'task-summary'
  | 'tag'
  | 'agent-name'
  | 'agent-color'
  | 'agent-setting'
  | 'mode'
  | 'pr-link'
  | 'worktree-state'
  | 'content-replacement'
  | 'file-history-snapshot'
  | 'attribution-snapshot'
  | 'marble-origami-commit'
  | 'marble-origami-snapshot';

/**
 * Base session entry
 */
export interface BaseSessionEntry {
  type: SessionEntryType;
  sessionId?: UUID;
  timestamp?: string;
}

/**
 * Custom title entry
 */
export interface CustomTitleEntry extends BaseSessionEntry {
  type: 'custom-title';
  customTitle: string;
}

/**
 * AI generated title entry
 */
export interface AiTitleEntry extends BaseSessionEntry {
  type: 'ai-title';
  aiTitle: string;
}

/**
 * Last prompt entry for resume display
 */
export interface LastPromptEntry extends BaseSessionEntry {
  type: 'last-prompt';
  lastPrompt: string;
}

/**
 * Session tag entry
 */
export interface TagEntry extends BaseSessionEntry {
  type: 'tag';
  tag: string;
}

/**
 * Agent metadata entry
 */
export interface AgentNameEntry extends BaseSessionEntry {
  type: 'agent-name';
  agentName: string;
}

export interface AgentColorEntry extends BaseSessionEntry {
  type: 'agent-color';
  agentColor: string;
}

export interface AgentSettingEntry extends BaseSessionEntry {
  type: 'agent-setting';
  agentSetting: string;
}

/**
 * Mode entry for coordinator detection
 */
export interface ModeEntry extends BaseSessionEntry {
  type: 'mode';
  mode: SessionMode;
}

/**
 * Worktree state entry
 */
export interface WorktreeStateEntry extends BaseSessionEntry {
  type: 'worktree-state';
  worktreeSession: PersistedWorktreeSession | null;
}

/**
 * Persisted worktree session state
 */
export interface PersistedWorktreeSession {
  originalCwd: string;
  worktreePath: string;
  worktreeName: string;
  worktreeBranch?: string;
  originalBranch?: string;
  originalHeadCommit?: string;
  sessionId: string;
  tmuxSessionName?: string;
  hookBased?: boolean;
}

/**
 * Content replacement record for tool result storage
 */
export interface ContentReplacementRecord {
  originalText: string;
  replacementText: string;
  toolUseId: string;
}

/**
 * Content replacement entry
 */
export interface ContentReplacementEntry extends BaseSessionEntry {
  type: 'content-replacement';
  agentId?: AgentId;
  replacements: ContentReplacementRecord[];
}

/**
 * File state for subagent context caching
 */
export interface FileState {
  content: string;
  timestamp: number;
  offset?: number;
  limit?: number;
  isPartialView?: boolean;
  hash?: string;
  size?: number;
  mtime?: number;
}

/**
 * File state cache configuration
 */
export interface FileStateCacheConfig {
  maxSize: number;
  maxAge: number;
  hashContent: boolean;
}

/**
 * File persistence entry for tracking changes
 */
export interface FilePersistenceEntry {
  path: string;
  originalContent: string;
  modifiedContent: string;
  timestamp: string;
  sessionId: string;
}

/**
 * File persistence configuration
 */
export interface FilePersistenceConfig {
  enabled: boolean;
  persistDir: string;
  maxEntries: number;
  autoCleanup: boolean;
}

/**
 * Requires action details for blocked sessions
 */
export interface RequiresActionDetails {
  tool_name: string;
  action_description: string;
  tool_use_id: string;
  request_id: string;
  input?: Record<string, unknown>;
}

/**
 * Session external metadata for CCR integration
 */
export interface SessionExternalMetadata {
  permission_mode?: string | null;
  is_ultraplan_mode?: boolean | null;
  model?: string | null;
  pending_action?: RequiresActionDetails | null;
  post_turn_summary?: unknown;
  task_summary?: string | null;
}

/**
 * Agent metadata for subagent transcripts
 */
export interface AgentMetadata {
  agentType: string;
  worktreePath?: string;
  description?: string;
}

/**
 * Log option for session listing
 */
export interface LogOption {
  date: string;
  messages: SessionMessage[];
  fullPath?: string;
  value: number;
  created: Date;
  modified: Date;
  firstPrompt: string;
  messageCount: number;
  fileSize?: number;
  isSidechain: boolean;
  isLite?: boolean;
  sessionId?: string;
  teamName?: string;
  agentName?: string;
  agentColor?: string;
  agentSetting?: string;
  isTeammate?: boolean;
  leafUuid?: UUID;
  summary?: string;
  customTitle?: string;
  tag?: string;
  fileHistorySnapshots?: unknown[];
  attributionSnapshots?: unknown[];
  contextCollapseCommits?: unknown[];
  contextCollapseSnapshot?: unknown;
  gitBranch?: string;
  projectPath?: string;
  prNumber?: number;
  prUrl?: string;
  prRepository?: string;
  mode?: SessionMode;
  worktreeSession?: PersistedWorktreeSession | null;
  contentReplacements?: ContentReplacementRecord[];
}