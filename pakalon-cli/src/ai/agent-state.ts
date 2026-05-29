/**
 * Agent State — Wait for idle + Busy state tracking.
 *
 * Tracks the agent's current operational state and provides
 * waitForIdle() for external consumers to await agent completion.
 *
 * States:
 * - idle: Agent is not processing anything
 * - thinking: Agent is generating a response (LLM call in progress)
 * - executing_tool: Agent is executing a tool
 * - waiting_permission: Agent is waiting for user permission
 * - interrupted: Agent was interrupted by a steer/follow-up
 * - error: Agent encountered an error
 *
 * Usage:
 *   const state = new AgentStateTracker();
 *   state.setState("thinking");
 *   // ... later ...
 *   await state.waitForIdle(); // Blocks until idle
 *   console.log("Agent is now idle");
 */

import logger from "@/utils/logger.js";
import { EventEmitter } from "events";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentPhase =
  | "idle"
  | "thinking"
  | "executing_tool"
  | "waiting_permission"
  | "interrupted"
  | "error";

export interface AgentStateChange {
  from: AgentPhase;
  to: AgentPhase;
  timestamp: Date;
  reason?: string;
}

export interface AgentStateSnapshot {
  phase: AgentPhase;
  currentTool?: string;
  currentTask?: string;
  startedAt?: Date;
  duration: number;
  stateChanges: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// State Tracker
// ─────────────────────────────────────────────────────────────────────────────

export class AgentStateTracker {
  private phase: AgentPhase = "idle";
  private emitter = new EventEmitter();
  private changes: AgentStateChange[] = [];
  private maxChanges = 100;
  private phaseStartTime: Date = new Date();
  private startTime: Date = new Date();
  private currentTool?: string;
  private currentTask?: string;
  private waitResolvers: Array<() => void> = [];

  constructor() {
    this.phase = "idle";
    this.phaseStartTime = new Date();
    this.startTime = new Date();
  }

  /**
   * Set the current agent phase.
   * Emits a state change event and resolves any pending waitForIdle() if now idle.
   */
  setState(phase: AgentPhase, reason?: string): void {
    const previous = this.phase;
    this.phase = phase;
    this.phaseStartTime = new Date();

    const change: AgentStateChange = {
      from: previous,
      to: phase,
      timestamp: new Date(),
      reason,
    };

    this.changes.push(change);
    if (this.changes.length > this.maxChanges) {
      this.changes.shift();
    }

    this.emitter.emit("stateChange", change);

    logger.debug("[AgentState] Phase changed", {
      from: previous,
      to: phase,
      reason,
    });

    // Resolve waiters if now idle
    if (phase === "idle") {
      const resolvers = this.waitResolvers;
      this.waitResolvers = [];
      for (const resolve of resolvers) {
        try {
          resolve();
        } catch {
          // Swallow
        }
      }
    }
  }

  /**
   * Get the current phase.
   */
  getState(): AgentPhase {
    return this.phase;
  }

  /**
   * Check if the agent is currently busy (not idle).
   */
  isBusy(): boolean {
    return this.phase !== "idle";
  }

  /**
   * Check if the agent is idle.
   */
  isIdle(): boolean {
    return this.phase === "idle";
  }

  /**
   * Set the current tool being executed.
   */
  setCurrentTool(toolName?: string): void {
    this.currentTool = toolName;
  }

  /**
   * Get the current tool being executed.
   */
  getCurrentTool(): string | undefined {
    return this.currentTool;
  }

  /**
   * Set the current task description.
   */
  setCurrentTask(task?: string): void {
    this.currentTask = task;
  }

  /**
   * Get the current task description.
   */
  getCurrentTask(): string | undefined {
    return this.currentTask;
  }

  /**
   * Wait until the agent becomes idle.
   * If already idle, returns immediately.
   *
   * @param timeout - Optional timeout in ms (default: no timeout)
   * @returns Resolves when idle, or rejects on timeout
   */
  async waitForIdle(timeout?: number): Promise<void> {
    if (this.phase === "idle") return;

    return new Promise<void>((resolve, reject) => {
      this.waitResolvers.push(resolve);

      if (timeout && timeout > 0) {
        setTimeout(() => {
          // Remove from resolvers
          const idx = this.waitResolvers.indexOf(resolve);
          if (idx >= 0) this.waitResolvers.splice(idx, 1);
          reject(new Error(`waitForIdle timed out after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  /**
   * Get a snapshot of the current state.
   */
  getSnapshot(): AgentStateSnapshot {
    return {
      phase: this.phase,
      currentTool: this.currentTool,
      currentTask: this.currentTask,
      startedAt: this.startTime,
      duration: Date.now() - this.phaseStartTime.getTime(),
      stateChanges: this.changes.length,
    };
  }

  /**
   * Get state change history.
   */
  getHistory(): AgentStateChange[] {
    return [...this.changes];
  }

  /**
   * Get time spent in current phase in ms.
   */
  getPhaseDuration(): number {
    return Date.now() - this.phaseStartTime.getTime();
  }

  /**
   * Get total elapsed time since creation in ms.
   */
  getTotalDuration(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Subscribe to state changes.
   */
  onStateChange(
    callback: (change: AgentStateChange) => void,
  ): () => void {
    this.emitter.on("stateChange", callback);
    return () => {
      this.emitter.off("stateChange", callback);
    };
  }

  /**
   * Get time breakdown by phase.
   */
  getTimeBreakdown(): Record<AgentPhase, number> {
    const breakdown: Record<string, number> = {
      idle: 0,
      thinking: 0,
      executing_tool: 0,
      waiting_permission: 0,
      interrupted: 0,
      error: 0,
    };

    let lastTime = this.startTime.getTime();
    for (const change of this.changes) {
      const duration = change.timestamp.getTime() - lastTime;
      if (duration > 0) {
        breakdown[change.from] = (breakdown[change.from] ?? 0) + duration;
      }
      lastTime = change.timestamp.getTime();
    }

    // Add time in current phase
    const currentDuration = Date.now() - lastTime;
    if (currentDuration > 0) {
      breakdown[this.phase] = (breakdown[this.phase] ?? 0) + currentDuration;
    }

    return breakdown as Record<AgentPhase, number>;
  }

  /**
   * Reset the state tracker.
   */
  reset(): void {
    this.phase = "idle";
    this.changes = [];
    this.phaseStartTime = new Date();
    this.startTime = new Date();
    this.currentTool = undefined;
    this.currentTask = undefined;
    this.waitResolvers = [];
  }
}
