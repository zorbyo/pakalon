/**
 * Session Manager - Main session management class
 * 
 * Provides high-level session management interface combining
 * all session management functionality.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SessionMessage } from './types.js';
import logger from '../utils/logger.js';
import { sessionStorage, SessionStorage } from './sessionStorage.js';
import { loadConversationForResume, listRecentSessions, searchSessions } from './conversationRecovery.js';
import { generateSessionTitle, generateTitleFromMessages } from './sessionTitle.js';
import type {
  SessionMetadata,
  SessionData,
  SessionStore,
  SessionResumeData,
  SessionListFilter,
} from './types.js';

const SESSION_DIR = path.join(os.homedir(), '.pakalon', 'sessions');

/**
 * File-based session store
 */
class FileSessionStore implements SessionStore {
  private sessionDir: string;

  constructor(sessionDir: string = SESSION_DIR) {
    this.sessionDir = sessionDir;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getSessionPath(id: string): string {
    return path.join(this.sessionDir, `${id}.json`);
  }

  private getMetadataPath(id: string): string {
    return path.join(this.sessionDir, `${id}.meta.json`);
  }

  async save(session: SessionData): Promise<void> {
    this.ensureDirectory();

    const sessionPath = this.getSessionPath(session.metadata.id);
    const metadataPath = this.getMetadataPath(session.metadata.id);

    session.metadata.updatedAt = new Date().toISOString();
    session.metadata.lastActivityAt = new Date().toISOString();

    try {
      await fs.promises.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
      await fs.promises.writeFile(metadataPath, JSON.stringify(session.metadata, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save session ${session.metadata.id}:`, err);
      throw err;
    }
  }

  async load(id: string): Promise<SessionData | null> {
    const sessionPath = this.getSessionPath(id);

    if (!fs.existsSync(sessionPath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(sessionPath, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch (err) {
      logger.error(`Failed to load session ${id}:`, err);
      return null;
    }
  }

  async list(filter?: SessionListFilter): Promise<SessionMetadata[]> {
    this.ensureDirectory();

    try {
      const files = await fs.promises.readdir(this.sessionDir);
      const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

      const metadatas: SessionMetadata[] = [];

      for (const file of metaFiles) {
        try {
          const content = await fs.promises.readFile(
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

      let result = metadatas.slice(offset, offset + limit);

      if (filter?.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        result = result.filter(
          (s) =>
            s.title?.toLowerCase().includes(query) ||
            s.tags?.some((t) => t.toLowerCase().includes(query))
        );
      }

      return result;
    } catch (err) {
      logger.error('Failed to list sessions:', err);
      return [];
    }
  }

  async delete(id: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(id);
    const metadataPath = this.getMetadataPath(id);

    try {
      if (fs.existsSync(sessionPath)) {
        await fs.promises.unlink(sessionPath);
      }
      if (fs.existsSync(metadataPath)) {
        await fs.promises.unlink(metadataPath);
      }
      return true;
    } catch (err) {
      logger.error(`Failed to delete session ${id}:`, err);
      return false;
    }
  }

  async exists(id: string): Promise<boolean> {
    return fs.existsSync(this.getSessionPath(id));
  }

  async archive(id: string): Promise<boolean> {
    const session = await this.load(id);
    if (!session) {
      return false;
    }

    session.metadata.archived = true;
    session.metadata.updatedAt = new Date().toISOString();
    await this.save(session);
    return true;
  }
}

/**
 * Session Manager - Main class for session lifecycle management
 */
export class SessionManager {
  private store: SessionStore;
  private storage: SessionStorage;
  private currentSession: SessionData | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private autoSaveInterval = 30000;

  constructor(store?: SessionStore, storage?: SessionStorage) {
    this.store = store || new FileSessionStore();
    this.storage = storage || sessionStorage;
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
    const id = uuidv4();
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

    await this.store.save(session);
    this.currentSession = session;
    this.storage.setCurrentSession(id);

    this.startAutoSave();

    return session;
  }

  /**
   * Load an existing session
   */
  async loadSession(id: string): Promise<SessionData | null> {
    const session = await this.store.load(id);

    if (session) {
      this.currentSession = session;
      this.storage.setCurrentSession(id);
      this.startAutoSave();
    }

    return session;
  }

  /**
   * Save the current session
   */
  async saveCurrentSession(): Promise<void> {
    if (this.currentSession) {
      await this.store.save(this.currentSession);
      this.storage.reAppendSessionMetadata();
    }
  }

  /**
   * Update the current session
   */
  async updateCurrentSession(updates: Partial<SessionData>): Promise<void> {
    if (this.currentSession) {
      this.currentSession = {
        ...this.currentSession,
        ...updates,
        metadata: {
          ...this.currentSession.metadata,
          ...(updates.metadata || {}),
          updatedAt: new Date().toISOString(),
        },
      };

      await this.store.save(this.currentSession);
    }
  }

  /**
   * Add a message to the current session
   */
  async addMessage(message: CoreMessage): Promise<void> {
    if (this.currentSession) {
      this.currentSession.messages.push(message);
      this.currentSession.metadata.turnCount =
        (this.currentSession.metadata.turnCount || 0) + 1;
      this.currentSession.metadata.lastActivityAt = new Date().toISOString();

      if (message.role === 'user') {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);
        this.storage.updateLastPrompt(content);
      }
    }
  }

  /**
   * Update session title
   */
  async updateTitle(title: string): Promise<void> {
    if (this.currentSession) {
      this.currentSession.metadata.title = title;
      await this.store.save(this.currentSession);
      this.storage.updateSessionTitle(title);
    }
  }

  /**
   * Generate and set title from messages
   */
  async generateTitle(messages: CoreMessage[]): Promise<string | null> {
    const title = await generateTitleFromMessages(messages);
    if (title && this.currentSession) {
      await this.updateTitle(title);
    }
    return title;
  }

  /**
   * List sessions
   */
  async listSessions(filter?: SessionListFilter): Promise<SessionMetadata[]> {
    return this.store.list(filter);
  }

  /**
   * Delete a session
   */
  async deleteSession(id: string): Promise<boolean> {
    if (this.currentSession?.metadata.id === id) {
      this.currentSession = null;
      this.stopAutoSave();
    }

    return this.store.delete(id);
  }

  /**
   * Archive a session
   */
  async archiveSession(id: string): Promise<boolean> {
    return this.store.archive(id);
  }

  /**
   * Get current session
   */
  getCurrentSession(): SessionData | null {
    return this.currentSession;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.currentSession?.metadata.id || null;
  }

  /**
   * Check if session exists
   */
  async sessionExists(id: string): Promise<boolean> {
    return this.store.exists(id);
  }

  /**
   * Resume a session
   */
  async resume(sessionId?: string): Promise<SessionResumeData | null> {
    return loadConversationForResume(sessionId);
  }

  /**
   * Shutdown session manager
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    await this.saveCurrentSession();
  }

  private startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(async () => {
      await this.saveCurrentSession();
    }, this.autoSaveInterval);
  }

  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }
}

export const sessionManager = new SessionManager();

export default sessionManager;