/**
 * Pending Write Queue System
 * 
 * Implements pi's PendingSessionWrite pattern with 8 write types
 * and deterministic flush ordering.
 */

import logger from '../utils/logger.js';
import { JsonlSessionStorage, type SessionTreeEntry } from './jsonl-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PendingWriteType =
  | "message"
  | "model_change"
  | "thinking_level_change"
  | "custom"
  | "custom_message"
  | "label"
  | "session_info"
  | "leaf";

export interface PendingSessionWrite {
  type: PendingWriteType;
  data: Record<string, unknown>;
}

export interface PendingWriteQueueConfig {
  /** Maximum queue size */
  maxQueueSize: number;
  /** Enable deterministic ordering */
  deterministicOrder: boolean;
  /** Log write operations */
  logWrites: boolean;
}

export const DEFAULT_PENDING_WRITE_CONFIG: PendingWriteQueueConfig = {
  maxQueueSize: 1000,
  deterministicOrder: true,
  logWrites: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pending Write Queue
// ─────────────────────────────────────────────────────────────────────────────

export class PendingWriteQueue {
  private queue: PendingSessionWrite[] = [];
  private config: PendingWriteQueueConfig;
  private flushCount = 0;
  private totalWrites = 0;

  constructor(config: Partial<PendingWriteQueueConfig> = {}) {
    this.config = { ...DEFAULT_PENDING_WRITE_CONFIG, ...config };
  }

  /**
   * Add a write to the queue
   */
  push(write: PendingSessionWrite): void {
    if (this.queue.length >= this.config.maxQueueSize) {
      logger.warn(`[PendingWriteQueue] Queue full, dropping oldest write`);
      this.queue.shift();
    }

    this.queue.push(write);
    this.totalWrites++;

    if (this.config.logWrites) {
      logger.debug(`[PendingWriteQueue] Pushed ${write.type} (queue size: ${this.queue.length})`);
    }
  }

  /**
   * Get the next write from the queue
   */
  shift(): PendingSessionWrite | undefined {
    const write = this.queue.shift();
    if (write && this.config.logWrites) {
      logger.debug(`[PendingWriteQueue] Shifted ${write.type} (queue size: ${this.queue.length})`);
    }
    return write;
  }

  /**
   * Peek at the next write without removing it
   */
  peek(): PendingSessionWrite | undefined {
    return this.queue[0];
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get queue as array
   */
  toArray(): PendingSessionWrite[] {
    return [...this.queue];
  }

  /**
   * Get writes by type
   */
  getByType(type: PendingWriteType): PendingSessionWrite[] {
    return this.queue.filter(w => w.type === type);
  }

  /**
   * Get statistics
   */
  getStats(): {
    queueSize: number;
    totalWrites: number;
    flushCount: number;
    writesByType: Record<PendingWriteType, number>;
  } {
    const writesByType = {} as Record<PendingWriteType, number>;
    for (const write of this.queue) {
      writesByType[write.type] = (writesByType[write.type] || 0) + 1;
    }

    return {
      queueSize: this.queue.length,
      totalWrites: this.totalWrites,
      flushCount: this.flushCount,
      writesByType,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write Queue Flush Handler
// ─────────────────────────────────────────────────────────────────────────────

export class WriteQueueFlushHandler {
  private queue: PendingWriteQueue;
  private storage: JsonlSessionStorage | null = null;
  private isFlushing = false;
  private flushPromise: Promise<number> | null = null;

  constructor(queue: PendingWriteQueue) {
    this.queue = queue;
  }

  /**
   * Set the storage to flush to
   */
  setStorage(storage: JsonlSessionStorage): void {
    this.storage = storage;
  }

  /**
   * Flush all pending writes to storage
   * 
   * Flush order is deterministic:
   * 1. session_info
   * 2. model_change
   * 3. thinking_level_change
   * 4. label
   * 5. custom
   * 6. custom_message
   * 7. message
   * 8. leaf
   */
  async flush(): Promise<number> {
    if (this.isFlushing) {
      return this.flushPromise as Promise<number>;
    }

    this.isFlushing = true;
    this.flushPromise = this.doFlush();

    try {
      return await this.flushPromise;
    } finally {
      this.isFlushing = false;
      this.flushPromise = null;
    }
  }

  /**
   * Perform the actual flush
   */
  private async doFlush(): Promise<number> {
    if (!this.storage || this.queue.isEmpty) {
      return 0;
    }

    const writes = this.queue.toArray();
    if (writes.length === 0) return 0;

    // Sort writes for deterministic ordering
    const sortedWrites = this.sortWrites(writes);
    let flushedCount = 0;

    for (const write of sortedWrites) {
      try {
        const entry = this.writeToEntry(write);
        if (entry) {
          await this.storage.appendEntry(entry);
          this.queue.shift(); // Remove from queue after successful write
          flushedCount++;
        }
      } catch (error) {
        logger.error(`[WriteQueueFlushHandler] Failed to flush ${write.type}:`, error);
        // Don't remove from queue on failure - will retry on next flush
      }
    }

    return flushedCount;
  }

  /**
   * Sort writes for deterministic ordering
   */
  private sortWrites(writes: PendingSessionWrite[]): PendingSessionWrite[] {
    const typeOrder: Record<PendingWriteType, number> = {
      session_info: 0,
      model_change: 1,
      thinking_level_change: 2,
      label: 3,
      custom: 4,
      custom_message: 5,
      message: 6,
      leaf: 7,
    };

    return [...writes].sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);
  }

  /**
   * Convert a pending write to a session tree entry
   */
  private writeToEntry(write: PendingSessionWrite): SessionTreeEntry | null {
    const base = {
      id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      parentId: null,
      timestamp: new Date().toISOString(),
    };

    switch (write.type) {
      case "message":
        return {
          ...base,
          type: "message",
          message: write.data.message as { role: string; content: string; timestamp: string },
        };
      case "model_change":
        return {
          ...base,
          type: "model_change",
          provider: write.data.provider as string,
          modelId: write.data.modelId as string,
        };
      case "thinking_level_change":
        return {
          ...base,
          type: "thinking_level_change",
          thinkingLevel: write.data.thinkingLevel as string,
        };
      case "custom":
        return {
          ...base,
          type: "custom",
          customType: write.data.customType as string,
          data: write.data.data,
        };
      case "custom_message":
        return {
          ...base,
          type: "custom_message",
          customType: write.data.customType as string,
          content: write.data.content as string,
          display: write.data.display as boolean,
          details: write.data.details,
        };
      case "label":
        return {
          ...base,
          type: "label",
          targetId: write.data.targetId as string,
          label: write.data.label as string | undefined,
        };
      case "session_info":
        return {
          ...base,
          type: "session_info",
          name: write.data.name as string | undefined,
        };
      case "leaf":
        return {
          ...base,
          type: "leaf",
          targetId: write.data.targetId as string | null,
        };
      default:
        return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createPendingWriteQueue(
  config?: Partial<PendingWriteQueueConfig>
): PendingWriteQueue {
  return new PendingWriteQueue(config);
}

export function createWriteQueueFlushHandler(
  queue: PendingWriteQueue
): WriteQueueFlushHandler {
  return new WriteQueueFlushHandler(queue);
}
