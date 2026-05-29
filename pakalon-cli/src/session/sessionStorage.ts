/**
 * Session Storage - Session persistence to disk
 * 
 * Handles saving and loading session data including:
 * - Session file management (JSONL format)
 * - Entry buffering and flushing
 * - Remote persistence integration
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import type { 
  SessionData, 
  SessionMetadata, 
  SessionEntryType,
  CustomTitleEntry,
  AiTitleEntry,
  LastPromptEntry,
  TagEntry,
  AgentNameEntry,
  AgentColorEntry,
  AgentSettingEntry,
  ModeEntry,
  ContentReplacementEntry,
  PersistedWorktreeSession,
  ContentReplacementRecord,
} from './types.js';
import type { SessionId, AgentId } from '../types-imported/ids.js';

const DEFAULT_SESSION_DIR = '.pakalon/sessions';
const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024; // 50MB
const FLUSH_INTERVAL_MS = 100;
const MAX_CHUNK_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Check if entry is a transcript message
 */
export function isTranscriptMessage(entry: { type: string }): boolean {
  return ['user', 'assistant', 'system', 'attachment'].includes(entry.type);
}

/**
 * Check if entry participates in parentUuid chain
 */
export function isChainParticipant(entry: { type: string }): boolean {
  return entry.type !== 'progress';
}

/**
 * Get session directory path
 */
export function getSessionDir(): string {
  return path.join(process.cwd(), DEFAULT_SESSION_DIR);
}

/**
 * Get projects directory
 */
export function getProjectsDir(): string {
  const configHome = process.env.PAKALON_CONFIG_DIR || path.join(os.homedir(), '.pakalon');
  return path.join(configHome, 'projects');
}

/**
 * Get project directory for a given working directory
 */
export function getProjectDir(projectDir: string): string {
  const sanitized = projectDir.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(getProjectsDir(), sanitized);
}

/**
 * Get transcript path for current session
 */
export function getTranscriptPath(sessionId: string, projectDir?: string): string {
  const dir = projectDir || getProjectDir(process.cwd());
  return path.join(dir, `${sessionId}.jsonl`);
}

/**
 * Get agent transcript path for subagent sessions
 */
export function getAgentTranscriptPath(
  agentId: AgentId,
  sessionId: string,
  projectDir?: string
): string {
  const dir = projectDir || getProjectDir(process.cwd());
  return path.join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/**
 * Get metadata path for agent
 */
export function getAgentMetadataPath(agentId: AgentId, sessionId: string, projectDir?: string): string {
  return getAgentTranscriptPath(agentId, sessionId, projectDir).replace(/\.jsonl$/, '.meta.json');
}

interface WriteQueueItem {
  entry: Record<string, unknown>;
  resolve: () => void;
}

/**
 * Session storage manager
 */
export class SessionStorage {
  private sessionDir: string;
  private sessionFile: string | null = null;
  private pendingEntries: Record<string, unknown>[] = [];
  private writeQueues = new Map<string, WriteQueueItem[]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private activeDrain: Promise<void> | null = null;
  private pendingWriteCount = 0;
  private flushResolvers: Array<() => void> = [] = [];
  private currentSessionId: string | null = null;
  private currentSessionTitle: string | undefined;
  private currentSessionLastPrompt: string | undefined;
  private currentSessionTag: string | undefined;
  private currentSessionAgentName: string | undefined;
  private currentSessionAgentColor: string | undefined;
  private currentSessionAgentSetting: string | undefined;
  private currentSessionMode: 'coordinator' | 'normal' | undefined;
  private currentSessionWorktree: PersistedWorktreeSession | null | undefined;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir || getSessionDir();
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fsSync.existsSync(this.sessionDir)) {
      fsSync.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.json`);
  }

  private getMetadataPath(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.meta.json`);
  }

  /**
   * Set the current session ID and initialize storage
   */
  setCurrentSession(sessionId: string, projectDir?: string): void {
    this.currentSessionId = sessionId;
    this.sessionFile = getTranscriptPath(sessionId, projectDir);
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Check if session file exists
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(sessionId);
    try {
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new session
   */
  async createSession(options?: {
    title?: string;
    model?: string;
    permissionMode?: string;
    workingDirectory?: string;
  }): Promise<SessionData> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const session: SessionData = {
      metadata: {
        id,
        title: options?.title || `Session ${new Date().toLocaleDateString()}`,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        model: options?.model,
        permissionMode: options?.permissionMode || 'normal',
        workingDirectory: options?.workingDirectory || process.cwd(),
        turnCount: 0,
        tokenCount: 0,
      },
      messages: [],
      context: {
        cwd: options?.workingDirectory || process.cwd(),
      },
      state: {},
    };

    await this.saveSession(session);
    this.setCurrentSession(id);

    return session;
  }

  /**
   * Save session to disk
   */
  async saveSession(session: SessionData): Promise<void> {
    this.ensureDirectory();

    const sessionPath = this.getSessionPath(session.metadata.id);
    const metadataPath = this.getMetadataPath(session.metadata.id);

    session.metadata.updatedAt = new Date().toISOString();
    session.metadata.lastActivityAt = new Date().toISOString();

    try {
      await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
      await fs.writeFile(metadataPath, JSON.stringify(session.metadata, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save session ${session.metadata.id}:`, err);
      throw err;
    }
  }

  /**
   * Load session from disk
   */
  async loadSession(id: string): Promise<SessionData | null> {
    const sessionPath = this.getSessionPath(id);

    if (!fsSync.existsSync(sessionPath)) {
      return null;
    }

    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch (err) {
      logger.error(`Failed to load session ${id}:`, err);
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(filter?: {
    archived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<SessionMetadata[]> {
    this.ensureDirectory();

    try {
      const files = await fs.readdir(this.sessionDir);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

      const metadatas: SessionMetadata[] = [];

      for (const file of metaFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.sessionDir, file),
            'utf-8'
          );
          const metadata = JSON.parse(content) as SessionMetadata;

          if (filter?.archived !== undefined && metadata.archived !== filter.archived) {
            continue;
          }

          metadatas.push(metadata);
        } catch {
          continue;
        }
      }

      metadatas.sort(
        (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
      );

      const offset = filter?.offset || 0;
      const limit = filter?.limit || 50;

      return metadatas.slice(offset, offset + limit);
    } catch (err) {
      logger.error('Failed to list sessions:', err);
      return [];
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(id);
    const metadataPath = this.getMetadataPath(id);

    try {
      if (fsSync.existsSync(sessionPath)) {
        await fs.unlink(sessionPath);
      }
      if (fsSync.existsSync(metadataPath)) {
        await fs.unlink(metadataPath);
      }
      return true;
    } catch (err) {
      logger.error(`Failed to delete session ${id}:`, err);
      return false;
    }
  }

  /**
   * Append entry to transcript file
   */
  async appendEntry(entry: Record<string, unknown>, targetFile?: string): Promise<void> {
    const filePath = targetFile || this.sessionFile;
    if (!filePath) {
      this.pendingEntries.push(entry);
      return;
    }

    return this.trackWrite(async () => {
      try {
        const line = JSON.stringify(entry) + '\n';
        await fs.appendFile(filePath, line, { encoding: 'utf-8' });
      } catch {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, JSON.stringify(entry) + '\n', { encoding: 'utf-8' });
      }
    });
  }

  private async trackWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.pendingWriteCount++;
    try {
      return await fn();
    } finally {
      this.pendingWriteCount--;
      if (this.pendingWriteCount === 0) {
        for (const resolve of this.flushResolvers) {
          resolve();
        }
        this.flushResolvers = [];
      }
    }
  }

  /**
   * Flush pending writes
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.activeDrain) {
      await this.activeDrain;
    }

    if (this.pendingWriteCount === 0) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  /**
   * Update session title
   */
  updateSessionTitle(title: string): void {
    this.currentSessionTitle = title;
    if (this.sessionFile && this.currentSessionId) {
      const entry: CustomTitleEntry = {
        type: 'custom-title',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        customTitle: title,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Update session last prompt
   */
  updateLastPrompt(prompt: string): void {
    this.currentSessionLastPrompt = prompt.length > 200 
      ? prompt.slice(0, 200).trim() + '…' 
      : prompt;
    
    if (this.sessionFile && this.currentSessionId) {
      const entry: LastPromptEntry = {
        type: 'last-prompt',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        lastPrompt: this.currentSessionLastPrompt,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Update session tag
   */
  updateSessionTag(tag: string): void {
    this.currentSessionTag = tag;
    if (this.sessionFile && this.currentSessionId) {
      const entry: TagEntry = {
        type: 'tag',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        tag,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Update agent metadata
   */
  updateAgentMetadata(
    name?: string,
    color?: string,
    setting?: string
  ): void {
    if (name) {
      this.currentSessionAgentName = name;
      if (this.sessionFile && this.currentSessionId) {
        const entry: AgentNameEntry = {
          type: 'agent-name',
          sessionId: this.currentSessionId as unknown as import('crypto').UUID,
          agentName: name,
        };
        this.appendEntry(entry);
      }
    }

    if (color) {
      this.currentSessionAgentColor = color;
      if (this.sessionFile && this.currentSessionId) {
        const entry: AgentColorEntry = {
          type: 'agent-color',
          sessionId: this.currentSessionId as unknown as import('crypto').UUID,
          agentColor: color,
        };
        this.appendEntry(entry);
      }
    }

    if (setting) {
      this.currentSessionAgentSetting = setting;
      if (this.sessionFile && this.currentSessionId) {
        const entry: AgentSettingEntry = {
          type: 'agent-setting',
          sessionId: this.currentSessionId as unknown as import('crypto').UUID,
          agentSetting: setting,
        };
        this.appendEntry(entry);
      }
    }
  }

  /**
   * Update session mode
   */
  updateSessionMode(mode: 'coordinator' | 'normal'): void {
    this.currentSessionMode = mode;
    if (this.sessionFile && this.currentSessionId) {
      const entry: ModeEntry = {
        type: 'mode',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        mode,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Update worktree state
   */
  updateWorktreeState(worktree: PersistedWorktreeSession | null): void {
    this.currentSessionWorktree = worktree;
    if (this.sessionFile && this.currentSessionId) {
      const entry = {
        type: 'worktree-state',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        worktreeSession: worktree,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Record content replacements
   */
  recordContentReplacements(replacements: ContentReplacementRecord[], agentId?: AgentId): void {
    if (this.sessionFile && this.currentSessionId) {
      const entry: ContentReplacementEntry = {
        type: 'content-replacement',
        sessionId: this.currentSessionId as unknown as import('crypto').UUID,
        agentId,
        replacements,
      };
      this.appendEntry(entry);
    }
  }

  /**
   * Get current session metadata
   */
  getCurrentMetadata(): Partial<SessionMetadata> {
    return {
      title: this.currentSessionTitle,
      lastActivityAt: new Date().toISOString(),
      tag: this.currentSessionTag,
      agentName: this.currentSessionAgentName,
      agentColor: this.currentSessionAgentColor,
      agentSetting: this.currentSessionAgentSetting,
      mode: this.currentSessionMode,
    };
  }

  /**
   * Write agent metadata to sidecar file
   */
  async writeAgentMetadata(agentId: AgentId, metadata: {
    agentType: string;
    worktreePath?: string;
    description?: string;
  }): Promise<void> {
    if (!this.currentSessionId) return;

    const metadataPath = getAgentMetadataPath(agentId, this.currentSessionId);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8');
  }

  /**
   * Read agent metadata from sidecar file
   */
  async readAgentMetadata(agentId: AgentId): Promise<{
    agentType: string;
    worktreePath?: string;
    description?: string;
  } | null> {
    if (!this.currentSessionId) return null;

    const metadataPath = getAgentMetadataPath(agentId, this.currentSessionId);
    try {
      const raw = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Re-append session metadata to transcript (for tail window)
   */
  reAppendSessionMetadata(): void {
    if (!this.sessionFile || !this.currentSessionId) return;

    const sessionId = this.currentSessionId as unknown as import('crypto').UUID;

    if (this.currentSessionLastPrompt) {
      this.appendEntry({
        type: 'last-prompt',
        sessionId,
        lastPrompt: this.currentSessionLastPrompt,
      });
    }

    if (this.currentSessionTitle) {
      this.appendEntry({
        type: 'custom-title',
        sessionId,
        customTitle: this.currentSessionTitle,
      });
    }

    if (this.currentSessionTag) {
      this.appendEntry({
        type: 'tag',
        sessionId,
        tag: this.currentSessionTag,
      });
    }

    if (this.currentSessionAgentName) {
      this.appendEntry({
        type: 'agent-name',
        sessionId,
        agentName: this.currentSessionAgentName,
      });
    }

    if (this.currentSessionAgentColor) {
      this.appendEntry({
        type: 'agent-color',
        sessionId,
        agentColor: this.currentSessionAgentColor,
      });
    }

    if (this.currentSessionAgentSetting) {
      this.appendEntry({
        type: 'agent-setting',
        sessionId,
        agentSetting: this.currentSessionAgentSetting,
      });
    }

    if (this.currentSessionMode) {
      this.appendEntry({
        type: 'mode',
        sessionId,
        mode: this.currentSessionMode,
      });
    }

    if (this.currentSessionWorktree !== undefined) {
      this.appendEntry({
        type: 'worktree-state',
        sessionId,
        worktreeSession: this.currentSessionWorktree,
      });
    }
  }

  /**
   * Reset for testing
   */
  reset(): void {
    this.sessionFile = null;
    this.pendingEntries = [];
    this.currentSessionId = null;
    this.currentSessionTitle = undefined;
    this.currentSessionLastPrompt = undefined;
    this.currentSessionTag = undefined;
    this.currentSessionAgentName = undefined;
    this.currentSessionAgentColor = undefined;
    this.currentSessionAgentSetting = undefined;
    this.currentSessionMode = undefined;
    this.currentSessionWorktree = undefined;
  }
}

export const sessionStorage = new SessionStorage();

export default sessionStorage;