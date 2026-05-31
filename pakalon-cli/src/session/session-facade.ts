/**
 * Session Facade
 * 
 * Provides a controlled interface for extensions to interact with the session.
 * Based on pi's session facade pattern for safe extension access.
 */

import { JsonlSessionStorage, type SessionTreeEntry, type AgentMessage } from './jsonl-storage.js';
import { SessionError } from './errors.js';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionFacadeReadOptions {
  includePending?: boolean;
}

export interface SessionFacadeWriteOptions {
  immediate?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Facade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session facade that wraps internal session storage.
 * 
 * Provides controlled read/write access for extensions while
 * enforcing harness pending-write ordering semantics.
 */
export class SessionFacade {
  private storage: JsonlSessionStorage;
  private pendingWrites: SessionTreeEntry[] = [];
  private _isBusy: boolean = false;

  constructor(storage: JsonlSessionStorage) {
    this.storage = storage;
  }

  /**
   * Set busy state for write ordering
   */
  setBusy(busy: boolean): void {
    this._isBusy = busy;
  }

  /**
   * Get session metadata
   */
  async getMetadata(): Promise<{
    id: string;
    createdAt: string;
    cwd: string;
  }> {
    return this.storage.getMetadata();
  }

  /**
   * Get current leaf ID
   */
  async getLeafId(): Promise<string | null> {
    return this.storage.getLeafId();
  }

  /**
   * Get entries from session
   */
  async getEntries(options?: SessionFacadeReadOptions): Promise<SessionTreeEntry[]> {
    const entries = await this.storage.getEntries();
    
    if (options?.includePending) {
      return [...entries, ...this.pendingWrites];
    }
    
    return entries;
  }

  /**
   * Get a specific entry by ID
   */
  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.storage.getEntry(id);
  }

  /**
   * Get path to root from an entry
   */
  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    return this.storage.getPathToRoot(leafId);
  }

  /**
   * Get label for an entry
   */
  async getLabel(id: string): Promise<string | undefined> {
    return this.storage.getLabel(id);
  }

  /**
   * Build context from session entries
   */
  async buildContext(): Promise<{
    messages: Array<{ role: string; content: string; timestamp: string }>;
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  }> {
    return this.storage.buildContext();
  }

  /**
   * Append a message to session
   * 
   * If harness is idle, persists immediately.
   * If harness is busy, queues as pending write.
   */
  async appendMessage(message: AgentMessage): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "message",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: message.role,
        content: message.content,
        timestamp: message.timestamp.toISOString(),
        metadata: message.metadata,
      },
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
      logger.debug("[SessionFacade] Message queued as pending write");
    } else {
      await this.storage.appendEntry(entry);
      logger.debug("[SessionFacade] Message persisted immediately");
    }
  }

  /**
   * Append a model change to session
   */
  async appendModelChange(provider: string, modelId: string): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "model_change",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Append a thinking level change to session
   */
  async appendThinkingLevelChange(thinkingLevel: string): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "thinking_level_change",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Append a compaction entry to session
   */
  async appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown,
    fromHook?: boolean,
  ): Promise<string> {
    const entryId = await this.storage.createEntryId();
    const entry: SessionTreeEntry = {
      type: "compaction",
      id: entryId,
      parentId: null,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }

    return entryId;
  }

  /**
   * Append a custom entry to session
   */
  async appendCustomEntry(customType: string, data?: unknown): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "custom",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      customType,
      data,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Append a custom message entry to session
   */
  async appendCustomMessageEntry(
    customType: string,
    content: string,
    display: boolean,
    details?: unknown,
  ): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "custom_message",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      customType,
      content,
      display,
      details,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Append a label to an entry
   */
  async appendLabel(targetId: string, label: string | undefined): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "label",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      targetId,
      label,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Append a session name entry
   */
  async appendSessionName(name: string): Promise<void> {
    const entry: SessionTreeEntry = {
      type: "session_info",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      name,
    };

    if (this._isBusy) {
      this.pendingWrites.push(entry);
    } else {
      await this.storage.appendEntry(entry);
    }
  }

  /**
   * Flush pending writes
   */
  async flushPendingWrites(): Promise<number> {
    const count = this.pendingWrites.length;
    
    for (const entry of this.pendingWrites) {
      await this.storage.appendEntry(entry);
    }
    
    this.pendingWrites = [];
    return count;
  }

  /**
   * Get pending writes count
   */
  getPendingWritesCount(): number {
    return this.pendingWrites.length;
  }

  /**
   * Clear pending writes
   */
  clearPendingWrites(): void {
    this.pendingWrites = [];
  }

  /**
   * Get the underlying storage
   */
  getStorage(): JsonlSessionStorage {
    return this.storage;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createSessionFacade(storage: JsonlSessionStorage): SessionFacade {
  return new SessionFacade(storage);
}
