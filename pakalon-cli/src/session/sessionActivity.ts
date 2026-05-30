/**
 * Session Activity Tracker
 *
 * Tracks user and agent actions during a session for activity monitoring
 * and idle detection.
 */

/**
 * Session action types.
 */
export type SessionActionType = 'tool_use' | 'message' | 'permission' | 'compaction' | 'error' | 'model_change' | 'mode_change';

/**
 * A single session action.
 */
export interface SessionAction {
  type: SessionActionType;
  timestamp: number;
  details: Record<string, unknown>;
}

/**
 * Tracks session activity for idle detection and monitoring.
 */
export class SessionActivityTracker {
  private actions: SessionAction[] = [];
  private readonly maxActions: number;

  constructor(options?: { maxActions?: number }) {
    this.maxActions = options?.maxActions ?? 1000;
  }

  /**
   * Track a new action.
   */
  trackAction(action: Omit<SessionAction, 'timestamp'>): void {
    this.actions.push({
      ...action,
      timestamp: Date.now(),
    });

    // Keep actions bounded
    if (this.actions.length > this.maxActions) {
      this.actions = this.actions.slice(-Math.floor(this.maxActions / 2));
    }
  }

  /**
   * Get recent actions.
   */
  getActions(options?: { limit?: number; since?: number }): SessionAction[] {
    let filtered = this.actions;

    if (options?.since) {
      filtered = filtered.filter((a) => a.timestamp >= options.since!);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Get total action count.
   */
  getActionCount(): number {
    return this.actions.length;
  }

  /**
   * Get the last action.
   */
  getLastActivity(): SessionAction | null {
    return this.actions.length > 0 ? this.actions[this.actions.length - 1]! : null;
  }

  /**
   * Get idle time in milliseconds since the last action.
   */
  getIdleTime(): number {
    const last = this.getLastActivity();
    if (!last) return Infinity;
    return Date.now() - last.timestamp;
  }

  /**
   * Get action counts by type.
   */
  getActionCounts(): Record<SessionActionType, number> {
    const counts: Record<string, number> = {};
    for (const action of this.actions) {
      counts[action.type] = (counts[action.type] ?? 0) + 1;
    }
    return counts as Record<SessionActionType, number>;
  }

  /**
   * Check if the session has been idle for a given duration.
   */
  isIdle(idleThresholdMs: number): boolean {
    return this.getIdleTime() >= idleThresholdMs;
  }

  /**
   * Clear all tracked actions.
   */
  clear(): void {
    this.actions = [];
  }
}

// Singleton instance
let _instance: SessionActivityTracker | null = null;

/**
 * Get the global session activity tracker.
 */
export function getSessionActivityTracker(): SessionActivityTracker {
  if (!_instance) {
    _instance = new SessionActivityTracker();
  }
  return _instance;
}
