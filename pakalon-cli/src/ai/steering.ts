/**
 * Steering/Follow-Up System — Interrupt agent mid-turn with follow-up instructions.
 *
 * Matches Claude Code's steering capability (T-A10 to T-A14):
 * - steer(followUp, options): Interrupt current agent turn with a follow-up
 * - FollowUpQueue: Manages pending follow-ups with priority ordering
 * - Auto-execution of high-priority follow-ups
 *
 * Flow:
 *   1. User provides follow-up during agent turn
 *   2. Follow-up is queued with priority
 *   3. Current turn is interrupted (if interrupt=true)
 *   4. Follow-up is processed as next turn input
 *
 * Usage:
 *   const steering = new SteeringManager();
 *   const result = await steering.steer("Actually, use PostgreSQL instead", {
 *     priority: "high",
 *     interrupt: true,
 *   });
 *
 *   // In agent loop:
 *   if (steering.isTurnInterrupted()) {
 *     const followUp = steering.getPendingFollowUp();
 *     steering.acknowledgeInterruption();
 *     // Process followUp.text as next user input
 *   }
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FollowUpPriority = "low" | "normal" | "high" | "critical";

export interface FollowUp {
  /** Unique identifier */
  id: string;
  /** The follow-up instruction text */
  text: string;
  /** Priority level */
  priority: FollowUpPriority;
  /** When the follow-up was created */
  createdAt: Date;
  /** If true, interrupts the current agent turn immediately */
  interruptCurrentTurn: boolean;
  /** Context captured from the interrupted turn */
  context?: {
    lastAssistantMessage?: string;
    pendingToolCalls?: Array<{ name: string; args: unknown }>;
    currentFile?: string;
  };
}

export interface SteeringOptions {
  /** Whether to interrupt the current turn immediately */
  interrupt?: boolean;
  /** Priority of the follow-up */
  priority?: FollowUpPriority;
  /** Timeout for the follow-up execution in ms */
  timeout?: number;
}

export interface SteeringResult {
  /** Whether the steer operation succeeded */
  success: boolean;
  /** The follow-up that was processed */
  followUp: FollowUp;
  /** Whether the current turn was interrupted */
  interruptedTurn: boolean;
  /** When the follow-up was processed */
  processedAt: Date;
}

export interface SteeringStats {
  /** Number of follow-ups currently queued */
  queued: number;
  /** Total follow-ups processed */
  processed: number;
  /** Whether a follow-up is currently active */
  active: boolean;
  /** Whether the current turn is interrupted */
  interrupted: boolean;
  /** Total interruption count */
  interruptionCount: number;
}

const PRIORITY_ORDER: Record<FollowUpPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Priority Queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Priority queue for follow-up items.
 * Items are sorted by priority (critical > high > normal > low),
 * then by creation time (FIFO within same priority).
 */
export class FollowUpQueue {
  private queue: FollowUp[] = [];
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  /**
   * Add a follow-up to the queue.
   * Automatically sorts by priority after enqueue.
   */
  enqueue(followUp: Omit<FollowUp, "id" | "createdAt">): FollowUp {
    const entry: FollowUp = {
      id: crypto.randomUUID(),
      text: followUp.text,
      priority: followUp.priority,
      createdAt: new Date(),
      interruptCurrentTurn: followUp.interruptCurrentTurn,
      context: followUp.context,
    };

    // Evict lowest priority if at capacity
    if (this.queue.length >= this.maxSize) {
      const removed = this.queue.pop();
      if (removed) {
        logger.warn("[Steering] Queue full, evicted follow-up", { id: removed.id, priority: removed.priority });
      }
    }

    this.queue.push(entry);
    this.sortByPriority();

    logger.debug("[Steering] Enqueued follow-up", { id: entry.id, priority: entry.priority });
    return entry;
  }

  /**
   * Remove and return the highest-priority follow-up.
   */
  dequeue(): FollowUp | undefined {
    return this.queue.shift();
  }

  /**
   * Peek at the highest-priority follow-up without removing it.
   */
  peek(): FollowUp | undefined {
    return this.queue[0];
  }

  /**
   * Remove all follow-ups from the queue.
   */
  clear(): void {
    this.queue = [];
    logger.debug("[Steering] Queue cleared");
  }

  /**
   * Get the number of items in the queue.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is empty.
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Remove a specific follow-up by ID.
   */
  remove(id: string): boolean {
    const index = this.queue.findIndex((f) => f.id === id);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    return true;
  }

  /**
   * Get all follow-ups with a specific priority.
   */
  getByPriority(priority: FollowUpPriority): FollowUp[] {
    return this.queue.filter((f) => f.priority === priority);
  }

  /**
   * Get all follow-ups in the queue (ordered by priority).
   */
  getAll(): FollowUp[] {
    return [...this.queue];
  }

  /**
   * Sort queue by priority (descending) then by creation time (ascending).
   */
  private sortByPriority(): void {
    this.queue.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Steering Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the steering/follow-up lifecycle.
 *
 * Coordinates between:
 * - User providing follow-up instructions
 * - Agent loop checking for interruptions
 * - Queue management with priority ordering
 */
export class SteeringManager {
  private queue: FollowUpQueue;
  private activeFollowUp: FollowUp | null = null;
  private isInterrupted = false;
  private processedCount = 0;
  private interruptionCount = 0;

  /** Called when a follow-up is enqueued */
  onEnqueue?: (followUp: FollowUp) => void;
  /** Called when a follow-up is dequeued for processing */
  onDequeue?: (followUp: FollowUp) => void;
  /** Called when the current turn is interrupted */
  onInterrupt?: (followUp: FollowUp) => void;
  /** Called when a follow-up completes processing */
  onComplete?: (result: SteeringResult) => void;

  constructor(options?: { maxQueueSize?: number }) {
    this.queue = new FollowUpQueue(options?.maxQueueSize);
  }

  /**
   * Send a follow-up to the agent.
   *
   * If interrupt=true and the agent is currently processing a turn,
   * the turn will be flagged for interruption. The agent loop should
   * check `isTurnInterrupted()` at the next safe point.
   *
   * @param followUp - The follow-up instruction text
   * @param options - Steering options (priority, interrupt, etc.)
   * @returns Result of the steering operation
   */
  async steer(
    followUp: string,
    options?: SteeringOptions,
  ): Promise<SteeringResult> {
    const entry = this.queue.enqueue({
      text: followUp,
      priority: options?.priority ?? "normal",
      interruptCurrentTurn: options?.interrupt ?? false,
    });

    // Fire enqueue event
    this.onEnqueue?.(entry);

    // Handle interruption
    let interruptedTurn = false;
    if (options?.interrupt && this.activeFollowUp) {
      this.isInterrupted = true;
      this.interruptionCount++;
      interruptedTurn = true;
      this.onInterrupt?.(entry);
      logger.info("[Steering] Turn interrupted by follow-up", {
        id: entry.id,
        text: followUp.slice(0, 100),
      });
    }

    const result: SteeringResult = {
      success: true,
      followUp: entry,
      interruptedTurn,
      processedAt: new Date(),
    };

    this.onComplete?.(result);
    return result;
  }

  /**
   * Get the highest-priority pending follow-up (without removing it).
   * Returns null if no follow-ups are pending.
   */
  getPendingFollowUp(): FollowUp | null {
    return this.queue.peek() ?? null;
  }

  /**
   * Acknowledge that the interruption was handled.
   * Clears the interruption flag and marks the follow-up as processed.
   */
  acknowledgeInterruption(): void {
    if (!this.isInterrupted) return;

    const followUp = this.queue.dequeue();
    if (followUp) {
      this.activeFollowUp = followUp;
      this.processedCount++;
      this.onDequeue?.(followUp);
    }

    this.isInterrupted = false;
    logger.debug("[Steering] Interruption acknowledged");
  }

  /**
   * Check if the current turn has been interrupted by a follow-up.
   * The agent loop should check this at safe points (between tool calls).
   */
  isTurnInterrupted(): boolean {
    return this.isInterrupted;
  }

  /**
   * Get statistics about the steering system state.
   */
  getStats(): SteeringStats {
    return {
      queued: this.queue.size(),
      processed: this.processedCount,
      active: this.activeFollowUp !== null,
      interrupted: this.isInterrupted,
      interruptionCount: this.interruptionCount,
    };
  }

  /**
   * Dequeue and return the next pending follow-up for processing.
   * Returns undefined if queue is empty.
   */
  processNext(): FollowUp | undefined {
    if (this.queue.isEmpty()) return undefined;

    const followUp = this.queue.dequeue();
    if (followUp) {
      this.activeFollowUp = followUp;
      this.processedCount++;
      this.onDequeue?.(followUp);
    }

    return followUp;
  }

  /**
   * Mark the active follow-up as completed and clear it.
   */
  completeActive(): void {
    this.activeFollowUp = null;
  }

  /**
   * Get the currently active follow-up.
   */
  getActiveFollowUp(): FollowUp | null {
    return this.activeFollowUp;
  }

  /**
   * Clear all pending follow-ups and reset interruption state.
   */
  clear(): void {
    this.queue.clear();
    this.activeFollowUp = null;
    this.isInterrupted = false;
    logger.debug("[Steering] All state cleared");
  }
}

/**
 * Create a default SteeringManager instance.
 */
export function createSteeringManager(): SteeringManager {
  return new SteeringManager();
}
