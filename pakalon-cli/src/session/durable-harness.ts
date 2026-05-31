/**
 * Durable Harness Recovery
 * 
 * Provides crash recovery and session durability based on pi's
 * durable-harness.md design. Handles recovery from:
 * - Interrupted agent turns
 * - Unfinished tool calls
 * - Provider request failures
 * - Compaction interruptions
 */

import logger from '../utils/logger.js';
import { SessionError, type Result, ok, err } from './errors.js';
import { JsonlSessionStorage, type SessionTreeEntry, type LeafEntry } from './jsonl-storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DurableHarnessConfig {
  /** Enable durable recovery */
  enabled: boolean;
  /** Maximum recovery attempts */
  maxRecoveryAttempts: number;
  /** Recovery timeout in ms */
  recoveryTimeoutMs: number;
}

export const DEFAULT_DURABLE_HARNESS_CONFIG: DurableHarnessConfig = {
  enabled: true,
  maxRecoveryAttempts: 3,
  recoveryTimeoutMs: 30000,
};

export interface RecoveryContext {
  sessionId: string;
  lastEntryId: string | null;
  lastLeafId: string | null;
  pendingOperations: string[];
  interruptedAt: Date;
}

export interface RecoveryResult {
  success: boolean;
  recoveredEntries: number;
  skippedOperations: string[];
  errors: string[];
}

export type OperationType = 
  | "agent_turn"
  | "tool_call"
  | "compaction"
  | "branch_summary"
  | "provider_request";

export interface DurableEntry {
  type: "durable_operation";
  id: string;
  parentId: string | null;
  timestamp: string;
  operationType: OperationType;
  status: "pending" | "in_progress" | "completed" | "failed" | "interrupted";
  metadata?: Record<string, unknown>;
  // Required by SessionTreeEntry but not used for durable operations
  targetId?: string | null;
}

/**
 * Convert DurableEntry to SessionTreeEntry format
 */
function durableToSessionEntry(entry: DurableEntry): SessionTreeEntry {
  return {
    type: "custom" as const,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
    customType: `durable_${entry.operationType}`,
    data: {
      operationType: entry.operationType,
      status: entry.status,
      ...entry.metadata,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable Harness
// ─────────────────────────────────────────────────────────────────────────────

export class DurableHarness {
  private config: DurableHarnessConfig;
  private storage: JsonlSessionStorage | null = null;
  private recoveryAttempts = 0;

  constructor(config: Partial<DurableHarnessConfig> = {}) {
    this.config = { ...DEFAULT_DURABLE_HARNESS_CONFIG, ...config };
  }

  /**
   * Initialize durable harness with session storage
   */
  async initialize(storage: JsonlSessionStorage): Promise<void> {
    this.storage = storage;
    this.recoveryAttempts = 0;

    if (this.config.enabled) {
      await this.attemptRecovery();
    }
  }

  /**
   * Record operation start
   */
  async recordOperationStart(
    operationType: OperationType,
    metadata?: Record<string, unknown>,
  ): Promise<string | null> {
    if (!this.storage || !this.config.enabled) {
      return null;
    }

    const entry: DurableEntry = {
      type: "durable_operation",
      id: await this.storage.createEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      operationType,
      status: "in_progress",
      metadata,
    };

    // Convert to SessionTreeEntry format for storage
    const sessionEntry = durableToSessionEntry(entry);
    await this.storage.appendEntry(sessionEntry);
    return entry.id;
  }

  /**
   * Record operation completion
   */
  async recordOperationComplete(entryId: string): Promise<void> {
    if (!this.storage || !this.config.enabled) {
      return;
    }

    const entry = await this.storage.getEntry(entryId);
    if (entry && entry.type === "custom" && entry.customType?.startsWith("durable_")) {
      // Update entry status
      const updatedEntry: DurableEntry = {
        type: "durable_operation",
        id: entry.id,
        parentId: entry.parentId,
        timestamp: new Date().toISOString(),
        operationType: entry.customType.replace("durable_", "") as OperationType,
        status: "completed",
      };
      const sessionEntry = durableToSessionEntry(updatedEntry);
      await this.storage.appendEntry(sessionEntry);
    }
  }

  /**
   * Record operation failure
   */
  async recordOperationFailure(entryId: string, error: string): Promise<void> {
    if (!this.storage || !this.config.enabled) {
      return;
    }

    const entry = await this.storage.getEntry(entryId);
    if (entry && entry.type === "custom" && entry.customType?.startsWith("durable_")) {
      const updatedEntry: DurableEntry = {
        type: "durable_operation",
        id: entry.id,
        parentId: entry.parentId,
        timestamp: new Date().toISOString(),
        operationType: entry.customType.replace("durable_", "") as OperationType,
        status: "failed",
        metadata: {
          error,
        },
      };
      const sessionEntry = durableToSessionEntry(updatedEntry);
      await this.storage.appendEntry(sessionEntry);
    }
  }

  /**
   * Attempt recovery from interrupted operations
   */
  private async attemptRecovery(): Promise<RecoveryResult> {
    if (!this.storage) {
      return {
        success: false,
        recoveredEntries: 0,
        skippedOperations: [],
        errors: ["No storage available"],
      };
    }

    const result: RecoveryResult = {
      success: false,
      recoveredEntries: 0,
      skippedOperations: [],
      errors: [],
    };

    try {
      // Get all entries
      const entries = await this.storage.getEntries();
      
      // Find interrupted operations
      const interruptedOps = entries
        .filter((e): e is Extract<SessionTreeEntry, { type: "custom" }> => 
          e.type === "custom" && 
          e.customType?.startsWith("durable_") &&
          ((e.data as any)?.status === "in_progress" || (e.data as any)?.status === "pending")
        )
        .map((e) => ({
          id: e.id,
          operationType: e.customType.replace("durable_", "") as OperationType,
          status: (e.data as any)?.status as string,
          metadata: e.data as Record<string, unknown> | undefined,
        }));

      if (interruptedOps.length === 0) {
        result.success = true;
        return result;
      }

      logger.info(`[DurableHarness] Found ${interruptedOps.length} interrupted operations`);

      // Process each interrupted operation
      for (const op of interruptedOps) {
        try {
          // Mark as interrupted
          const updatedOp: DurableEntry = {
            type: "durable_operation",
            id: op.id,
            parentId: null,
            timestamp: new Date().toISOString(),
            operationType: op.operationType,
            status: "interrupted",
            metadata: {
              ...op.metadata,
              interruptedAt: new Date().toISOString(),
              recoveryAttempt: this.recoveryAttempts,
            },
          };
          const sessionEntry = durableToSessionEntry(updatedOp);
          await this.storage.appendEntry(sessionEntry);
          result.recoveredEntries++;
          
          // Skip operations that can't be retried
          if (op.operationType === "tool_call" || op.operationType === "provider_request") {
            result.skippedOperations.push(`${op.operationType}:${op.id}`);
          }
        } catch (error) {
          result.errors.push(`Failed to recover ${op.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      result.success = result.errors.length === 0;
      this.recoveryAttempts++;

    } catch (error) {
      result.errors.push(`Recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  /**
   * Get recovery context
   */
  async getRecoveryContext(): Promise<RecoveryContext | null> {
    if (!this.storage) {
      return null;
    }

    const entries = await this.storage.getEntries();
    const leafId = await this.storage.getLeafId();
    
    // Find last entry
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
    
    // Find pending operations
    const pendingOps = entries
      .filter((e): e is DurableEntry => 
        e.type === "durable_operation" && 
        (e.status === "in_progress" || e.status === "pending")
      )
      .map((e) => `${e.operationType}:${e.id}`);

    return {
      sessionId: (await this.storage.getMetadata()).id,
      lastEntryId: lastEntry?.id ?? null,
      lastLeafId: leafId,
      pendingOperations: pendingOps,
      interruptedAt: new Date(),
    };
  }

  /**
   * Check if recovery is needed
   */
  async needsRecovery(): Promise<boolean> {
    if (!this.storage || !this.config.enabled) {
      return false;
    }

    const entries = await this.storage.getEntries();
    return entries.some(
      (e): e is Extract<SessionTreeEntry, { type: "custom" }> => 
        e.type === "custom" && 
        e.customType?.startsWith("durable_") &&
        ((e.data as any)?.status === "in_progress" || (e.data as any)?.status === "pending")
    );
  }

  /**
   * Get recovery statistics
   */
  getStats(): {
    enabled: boolean;
    recoveryAttempts: number;
    maxRecoveryAttempts: number;
  } {
    return {
      enabled: this.config.enabled,
      recoveryAttempts: this.recoveryAttempts,
      maxRecoveryAttempts: this.config.maxRecoveryAttempts,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createDurableHarness(config?: Partial<DurableHarnessConfig>): DurableHarness {
  return new DurableHarness(config);
}
