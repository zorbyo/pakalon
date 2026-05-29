/**
 * Enhanced Steering System — Queue management with events, rollback, and modes.
 *
 * Adds to existing steering.ts:
 * - queue_update events for UI synchronization
 * - Queue rollback on hook failure
 * - nextTurn() for next user-initiated turn
 * - Queue modes: "all" or "one-at-a-time"
 * - Queue state persistence
 *
 * Port from Pi's AgentHarness queue management.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type QueueMode = "all" | "one-at-a-time";

export type QueueType = "steering" | "followUp" | "nextTurn";

export type QueueAction = "enqueue" | "dequeue" | "clear" | "rollback";

export interface QueueItem {
  /** Unique identifier */
  id: string;
  /** Message text */
  text: string;
  /** Queue type */
  queueType: QueueType;
  /** Priority level */
  priority: "low" | "normal" | "high" | "critical";
  /** When the item was created */
  createdAt: Date;
  /** Context captured from the interrupted turn */
  context?: {
    lastAssistantMessage?: string;
    pendingToolCalls?: Array<{ name: string; args: unknown }>;
    currentFile?: string;
  };
  /** Whether this item can be rolled back */
  rollbackable: boolean;
}

export interface QueueUpdateEvent {
  /** Event type */
  type: "queue_update";
  /** Queue type */
  queueType: QueueType;
  /** Queue action */
  action: QueueAction;
  /** Queue size after action */
  queueSize: number;
  /** Affected item */
  item?: QueueItem;
  /** Timestamp */
  timestamp: Date;
}

export interface EnhancedSteeringConfig {
  /** Queue mode for steering */
  steeringMode: QueueMode;
  /** Queue mode for follow-ups */
  followUpMode: QueueMode;
  /** Queue mode for next-turn */
  nextTurnMode: QueueMode;
  /** Maximum queue sizes */
  maxSizes: {
    steering: number;
    followUp: number;
    nextTurn: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Steering Manager
// ─────────────────────────────────────────────────────────────────────────────

export class EnhancedSteeringManager {
  private steeringQueue: QueueItem[] = [];
  private followUpQueue: QueueItem[] = [];
  private nextTurnQueue: QueueItem[] = [];
  private config: EnhancedSteeringConfig;
  private eventListeners: Array<(event: QueueUpdateEvent) => void> = [];

  constructor(config?: Partial<EnhancedSteeringConfig>) {
    this.config = {
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      nextTurnMode: "one-at-a-time",
      maxSizes: {
        steering: 50,
        followUp: 50,
        nextTurn: 50,
      },
      ...config,
    };
  }

  /**
   * Subscribe to queue update events.
   */
  onQueueUpdate(listener: (event: QueueUpdateEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit a queue update event.
   */
  private emitQueueUpdate(event: QueueUpdateEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("[EnhancedSteering] Event listener error", { error: String(error) });
      }
    }
  }

  /**
   * Add a steering message (interrupt current turn).
   */
  steer(
    text: string,
    options?: {
      priority?: QueueItem["priority"];
      context?: QueueItem["context"];
      rollbackable?: boolean;
    }
  ): QueueItem {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      text,
      queueType: "steering",
      priority: options?.priority ?? "normal",
      createdAt: new Date(),
      context: options?.context,
      rollbackable: options?.rollbackable ?? true,
    };

    // Enforce queue size limit
    if (this.steeringQueue.length >= this.config.maxSizes.steering) {
      const removed = this.steeringQueue.shift();
      logger.warn("[EnhancedSteering] Steering queue full, removed oldest", {
        id: removed?.id,
      });
    }

    this.steeringQueue.push(item);
    this.sortQueue(this.steeringQueue);

    this.emitQueueUpdate({
      type: "queue_update",
      queueType: "steering",
      action: "enqueue",
      queueSize: this.steeringQueue.length,
      item,
      timestamp: new Date(),
    });

    return item;
  }

  /**
   * Add a follow-up message (processed after current turn).
   */
  followUp(
    text: string,
    options?: {
      priority?: QueueItem["priority"];
      context?: QueueItem["context"];
      rollbackable?: boolean;
    }
  ): QueueItem {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      text,
      queueType: "followUp",
      priority: options?.priority ?? "normal",
      createdAt: new Date(),
      context: options?.context,
      rollbackable: options?.rollbackable ?? true,
    };

    // Enforce queue size limit
    if (this.followUpQueue.length >= this.config.maxSizes.followUp) {
      const removed = this.followUpQueue.shift();
      logger.warn("[EnhancedSteering] FollowUp queue full, removed oldest", {
        id: removed?.id,
      });
    }

    this.followUpQueue.push(item);
    this.sortQueue(this.followUpQueue);

    this.emitQueueUpdate({
      type: "queue_update",
      queueType: "followUp",
      action: "enqueue",
      queueSize: this.followUpQueue.length,
      item,
      timestamp: new Date(),
    });

    return item;
  }

  /**
   * Add a next-turn message (processed on next user-initiated turn).
   */
  nextTurn(
    text: string,
    options?: {
      priority?: QueueItem["priority"];
      context?: QueueItem["context"];
      rollbackable?: boolean;
    }
  ): QueueItem {
    const item: QueueItem = {
      id: crypto.randomUUID(),
      text,
      queueType: "nextTurn",
      priority: options?.priority ?? "normal",
      createdAt: new Date(),
      context: options?.context,
      rollbackable: options?.rollbackable ?? true,
    };

    // Enforce queue size limit
    if (this.nextTurnQueue.length >= this.config.maxSizes.nextTurn) {
      const removed = this.nextTurnQueue.shift();
      logger.warn("[EnhancedSteering] NextTurn queue full, removed oldest", {
        id: removed?.id,
      });
    }

    this.nextTurnQueue.push(item);
    this.sortQueue(this.nextTurnQueue);

    this.emitQueueUpdate({
      type: "queue_update",
      queueType: "nextTurn",
      action: "enqueue",
      queueSize: this.nextTurnQueue.length,
      item,
      timestamp: new Date(),
    });

    return item;
  }

  /**
   * Get and dequeue the next steering message.
   */
  dequeueSteering(): QueueItem | undefined {
    const item = this.steeringQueue.shift();
    if (item) {
      this.emitQueueUpdate({
        type: "queue_update",
        queueType: "steering",
        action: "dequeue",
        queueSize: this.steeringQueue.length,
        item,
        timestamp: new Date(),
      });
    }
    return item;
  }

  /**
   * Get and dequeue the next follow-up message.
   */
  dequeueFollowUp(): QueueItem | undefined {
    const item = this.followUpQueue.shift();
    if (item) {
      this.emitQueueUpdate({
        type: "queue_update",
        queueType: "followUp",
        action: "dequeue",
        queueSize: this.followUpQueue.length,
        item,
        timestamp: new Date(),
      });
    }
    return item;
  }

  /**
   * Get and dequeue the next next-turn message.
   */
  dequeueNextTurn(): QueueItem | undefined {
    const item = this.nextTurnQueue.shift();
    if (item) {
      this.emitQueueUpdate({
        type: "queue_update",
        queueType: "nextTurn",
        action: "dequeue",
        queueSize: this.nextTurnQueue.length,
        item,
        timestamp: new Date(),
      });
    }
    return item;
  }

  /**
   * Peek at the next steering message without dequeuing.
   */
  peekSteering(): QueueItem | undefined {
    return this.steeringQueue[0];
  }

  /**
   * Peek at the next follow-up message without dequeuing.
   */
  peekFollowUp(): QueueItem | undefined {
    return this.followUpQueue[0];
  }

  /**
   * Peek at the next next-turn message without dequeuing.
   */
  peekNextTurn(): QueueItem | undefined {
    return this.nextTurnQueue[0];
  }

  /**
   * Rollback the last dequeued item from a specific queue.
   */
  rollback(queueType: QueueType, itemId: string): boolean {
    let queue: QueueItem[];
    switch (queueType) {
      case "steering":
        queue = this.steeringQueue;
        break;
      case "followUp":
        queue = this.followUpQueue;
        break;
      case "nextTurn":
        queue = this.nextTurnQueue;
        break;
    }

    // Find the item in the queue (it might have been re-added)
    const itemIndex = queue.findIndex((i) => i.id === itemId);
    if (itemIndex === -1) {
      logger.warn("[EnhancedSteering] Cannot rollback, item not found", {
        queueType,
        itemId,
      });
      return false;
    }

    // Check if rollbackable
    const item = queue[itemIndex];
    if (!item?.rollbackable) {
      logger.warn("[EnhancedSteering] Cannot rollback, item not rollbackable", {
        queueType,
        itemId,
      });
      return false;
    }

    // Remove the item
    queue.splice(itemIndex, 1);

    this.emitQueueUpdate({
      type: "queue_update",
      queueType,
      action: "rollback",
      queueSize: queue.length,
      item,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * Clear all items from a specific queue.
   */
  clearQueue(queueType: QueueType): void {
    switch (queueType) {
      case "steering":
        this.steeringQueue = [];
        break;
      case "followUp":
        this.followUpQueue = [];
        break;
      case "nextTurn":
        this.nextTurnQueue = [];
        break;
    }

    this.emitQueueUpdate({
      type: "queue_update",
      queueType,
      action: "clear",
      queueSize: 0,
      timestamp: new Date(),
    });
  }

  /**
   * Clear all queues.
   */
  clearAll(): void {
    this.clearQueue("steering");
    this.clearQueue("followUp");
    this.clearQueue("nextTurn");
  }

  /**
   * Check if there are pending steering messages.
   */
  hasSteering(): boolean {
    return this.steeringQueue.length > 0;
  }

  /**
   * Check if there are pending follow-up messages.
   */
  hasFollowUp(): boolean {
    return this.followUpQueue.length > 0;
  }

  /**
   * Check if there are pending next-turn messages.
   */
  hasNextTurn(): boolean {
    return this.nextTurnQueue.length > 0;
  }

  /**
   * Get queue sizes.
   */
  getQueueSizes(): { steering: number; followUp: number; nextTurn: number } {
    return {
      steering: this.steeringQueue.length,
      followUp: this.followUpQueue.length,
      nextTurn: this.nextTurnQueue.length,
    };
  }

  /**
   * Get queue mode.
   */
  getMode(queueType: QueueType): QueueMode {
    switch (queueType) {
      case "steering":
        return this.config.steeringMode;
      case "followUp":
        return this.config.followUpMode;
      case "nextTurn":
        return this.config.nextTurnMode;
    }
  }

  /**
   * Set queue mode.
   */
  setMode(queueType: QueueType, mode: QueueMode): void {
    switch (queueType) {
      case "steering":
        this.config.steeringMode = mode;
        break;
      case "followUp":
        this.config.followUpMode = mode;
        break;
      case "nextTurn":
        this.config.nextTurnMode = mode;
        break;
    }
    logger.debug("[EnhancedSteering] Mode set", { queueType, mode });
  }

  private sortQueue(queue: QueueItem[]): void {
    const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
    queue.sort((a, b) => {
      const diff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (diff !== 0) return diff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let steeringInstance: EnhancedSteeringManager | null = null;

/**
 * Get the singleton enhanced steering manager.
 */
export function getEnhancedSteeringManager(
  config?: Partial<EnhancedSteeringConfig>
): EnhancedSteeringManager {
  if (!steeringInstance) {
    steeringInstance = new EnhancedSteeringManager(config);
  }
  return steeringInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetEnhancedSteeringManager(): void {
  steeringInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a steering message.
 */
export function steer(
  text: string,
  options?: { priority?: QueueItem["priority"]; rollbackable?: boolean }
): QueueItem {
  return getEnhancedSteeringManager().steer(text, options);
}

/**
 * Send a follow-up message.
 */
export function followUp(
  text: string,
  options?: { priority?: QueueItem["priority"]; rollbackable?: boolean }
): QueueItem {
  return getEnhancedSteeringManager().followUp(text, options);
}

/**
 * Send a next-turn message.
 */
export function nextTurn(
  text: string,
  options?: { priority?: QueueItem["priority"]; rollbackable?: boolean }
): QueueItem {
  return getEnhancedSteeringManager().nextTurn(text, options);
}

/**
 * Check if there are any pending messages.
 */
export function hasPendingMessages(): boolean {
  const manager = getEnhancedSteeringManager();
  return manager.hasSteering() || manager.hasFollowUp() || manager.hasNextTurn();
}
