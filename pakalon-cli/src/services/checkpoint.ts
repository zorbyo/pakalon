/**
 * Checkpoint/Rewind
 * 
 * Manages conversation state checkpoints and rewind capability.
 * Based on OMP's checkpoint/rewind feature.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ConversationCheckpoint {
  id: string;
  timestamp: number;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
  }>;
  metadata?: Record<string, unknown>;
  label?: string;
}

export interface RewindResult {
  success: boolean;
  checkpointId: string;
  messagesRestored: number;
  timestamp: number;
}

// ============================================================================
// Checkpoint Manager
// ============================================================================

export class CheckpointManager {
  private checkpoints: Map<string, ConversationCheckpoint> = new Map();
  private maxCheckpoints: number;
  private maxAgeMs: number;

  constructor(options?: {
    maxCheckpoints?: number;
    maxAgeMs?: number;
  }) {
    this.maxCheckpoints = options?.maxCheckpoints || 50;
    this.maxAgeMs = options?.maxAgeMs || 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Create a checkpoint of the current conversation state
   */
  createCheckpoint(
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp?: number;
    }>,
    options?: {
      label?: string;
      metadata?: Record<string, unknown>;
    }
  ): ConversationCheckpoint {
    const id = `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const checkpoint: ConversationCheckpoint = {
      id,
      timestamp: Date.now(),
      messages: [...messages],
      metadata: options?.metadata,
      label: options?.label,
    };

    this.checkpoints.set(id, checkpoint);
    this.cleanupOldCheckpoints();

    logger.debug('[checkpoint] Created checkpoint', {
      id,
      messageCount: messages.length,
      label: options?.label,
    });

    return checkpoint;
  }

  /**
   * Rewind to a specific checkpoint
   */
  rewind(checkpointId: string): RewindResult {
    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      logger.warn('[checkpoint] Checkpoint not found', { checkpointId });
      return {
        success: false,
        checkpointId,
        messagesRestored: 0,
        timestamp: Date.now(),
      };
    }

    logger.debug('[checkpoint] Rewound to checkpoint', {
      checkpointId,
      messageCount: checkpoint.messages.length,
    });

    return {
      success: true,
      checkpointId,
      messagesRestored: checkpoint.messages.length,
      timestamp: checkpoint.timestamp,
    };
  }

  /**
   * Get checkpoint messages
   */
  getCheckpointMessages(checkpointId: string): Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: number;
  }> | null {
    const checkpoint = this.checkpoints.get(checkpointId);
    return checkpoint ? [...checkpoint.messages] : null;
  }

  /**
   * List all checkpoints
   */
  listCheckpoints(): ConversationCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    return this.checkpoints.delete(checkpointId);
  }

  /**
   * Clear all checkpoints
   */
  clear(): void {
    this.checkpoints.clear();
  }

  /**
   * Cleanup old checkpoints
   */
  private cleanupOldCheckpoints(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    // Delete checkpoints older than maxAgeMs
    for (const [id, checkpoint] of this.checkpoints) {
      if (now - checkpoint.timestamp > this.maxAgeMs) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.checkpoints.delete(id);
    }

    // If still over maxCheckpoints, delete oldest
    if (this.checkpoints.size > this.maxCheckpoints) {
      const sorted = this.listCheckpoints();
      const toRemove = sorted.slice(this.maxCheckpoints);
      for (const checkpoint of toRemove) {
        this.checkpoints.delete(checkpoint.id);
      }
    }
  }

  /**
   * Get checkpoint count
   */
  getCheckpointCount(): number {
    return this.checkpoints.size;
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): {
    totalCheckpoints: number;
    oldestCheckpoint: number | null;
    newestCheckpoint: number | null;
    totalMessages: number;
  } {
    const checkpoints = this.listCheckpoints();
    const totalMessages = checkpoints.reduce((sum, cp) => sum + cp.messages.length, 0);

    return {
      totalCheckpoints: checkpoints.length,
      oldestCheckpoint: checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].timestamp : null,
      newestCheckpoint: checkpoints.length > 0 ? checkpoints[0].timestamp : null,
      totalMessages,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: CheckpointManager | null = null;

export function getCheckpointManager(options?: {
  maxCheckpoints?: number;
  maxAgeMs?: number;
}): CheckpointManager {
  if (!managerInstance) {
    managerInstance = new CheckpointManager(options);
  }
  return managerInstance;
}

export function resetCheckpointManager(): void {
  managerInstance = null;
}
