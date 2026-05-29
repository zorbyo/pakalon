/**
 * Agent Lifecycle — Event streaming for agent execution lifecycle.
 *
 * Provides comprehensive lifecycle events:
 * - agent_start/end: Agent execution begins/ends
 * - turn_start/end: LLM turn begins/ends
 * - message_start/update/end: Message streaming
 * - tool_execution_start/update/end: Tool execution
 * - waitForIdle(): Wait for agent to complete
 * - busy state tracking
 *
 * Port from Pi's Agent event streaming.
 */

import { EventEmitter } from "events";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentPhase = "idle" | "starting" | "streaming" | "tool_execution" | "settling" | "error";

export type LifecycleEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent;

export interface AgentStartEvent {
  type: "agent_start";
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface AgentEndEvent {
  type: "agent_end";
  agentId: string;
  sessionId: string;
  messageCount: number;
  toolCount: number;
  durationMs: number;
  timestamp: Date;
}

export interface TurnStartEvent {
  type: "turn_start";
  turnId: string;
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface TurnEndEvent {
  type: "turn_end";
  turnId: string;
  agentId: string;
  sessionId: string;
  messageCount: number;
  toolResults: unknown[];
  durationMs: number;
  timestamp: Date;
}

export interface MessageStartEvent {
  type: "message_start";
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface MessageUpdateEvent {
  type: "message_update";
  messageId: string;
  delta: string;
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface MessageEndEvent {
  type: "message_end";
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  agentId: string;
  sessionId: string;
  tokenCount?: number;
  timestamp: Date;
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  partialResult: unknown;
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  durationMs: number;
  success: boolean;
  agentId: string;
  sessionId: string;
  timestamp: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Lifecycle Manager
// ─────────────────────────────────────────────────────────────────────────────

export class AgentLifecycleManager {
  private emitter = new EventEmitter();
  private phase: AgentPhase = "idle";
  private agentId: string;
  private sessionId: string;
  private messageCount = 0;
  private toolCount = 0;
  private turnCount = 0;
  private startTime?: Date;
  private turnStartTime?: Date;

  constructor(agentId: string, sessionId: string) {
    this.agentId = agentId;
    this.sessionId = sessionId;
    this.emitter.setMaxListeners(100);
  }

  /**
   * Subscribe to lifecycle events.
   */
  on<T extends LifecycleEvent>(
    eventType: T["type"],
    listener: (event: T) => void
  ): () => void {
    this.emitter.on(eventType, listener);
    return () => {
      this.emitter.off(eventType, listener);
    };
  }

  /**
   * Subscribe to all events.
   */
  onAll(listener: (event: LifecycleEvent) => void): () => void {
    const wrapper = (event: LifecycleEvent) => listener(event);
    this.emitter.on("*", wrapper);
    return () => {
      this.emitter.off("*", wrapper);
    };
  }

  /**
   * Emit an event.
   */
  private emit(event: LifecycleEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  /**
   * Get current phase.
   */
  getPhase(): AgentPhase {
    return this.phase;
  }

  /**
   * Check if agent is busy.
   */
  isBusy(): boolean {
    return this.phase !== "idle";
  }

  /**
   * Wait for agent to become idle.
   */
  async waitForIdle(timeoutMs?: number): Promise<void> {
    if (this.phase === "idle") return;

    return new Promise((resolve, reject) => {
      const timeout = timeoutMs ? setTimeout(() => {
        reject(new Error("Timeout waiting for idle"));
      }, timeoutMs) : undefined;

      const check = () => {
        if (this.phase === "idle") {
          if (timeout) clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Emit agent_start event.
   */
  emitAgentStart(): void {
    this.phase = "starting";
    this.startTime = new Date();
    this.messageCount = 0;
    this.toolCount = 0;
    this.turnCount = 0;

    this.emit({
      type: "agent_start",
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit agent_end event.
   */
  emitAgentEnd(): void {
    const durationMs = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    this.emit({
      type: "agent_end",
      agentId: this.agentId,
      sessionId: this.sessionId,
      messageCount: this.messageCount,
      toolCount: this.toolCount,
      durationMs,
      timestamp: new Date(),
    });

    this.phase = "idle";
  }

  /**
   * Emit turn_start event.
   */
  emitTurnStart(): string {
    this.phase = "streaming";
    this.turnStartTime = new Date();
    this.turnCount++;

    const turnId = `turn_${this.turnCount}_${Date.now()}`;

    this.emit({
      type: "turn_start",
      turnId,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });

    return turnId;
  }

  /**
   * Emit turn_end event.
   */
  emitTurnEnd(turnId: string, toolResults: unknown[]): void {
    const durationMs = this.turnStartTime ? Date.now() - this.turnStartTime.getTime() : 0;

    this.emit({
      type: "turn_end",
      turnId,
      agentId: this.agentId,
      sessionId: this.sessionId,
      messageCount: this.messageCount,
      toolResults,
      durationMs,
      timestamp: new Date(),
    });

    this.phase = "settling";
  }

  /**
   * Emit message_start event.
   */
  emitMessageStart(role: MessageStartEvent["role"]): string {
    const messageId = `msg_${++this.messageCount}_${Date.now()}`;

    this.emit({
      type: "message_start",
      messageId,
      role,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });

    return messageId;
  }

  /**
   * Emit message_update event.
   */
  emitMessageUpdate(messageId: string, delta: string): void {
    this.emit({
      type: "message_update",
      messageId,
      delta,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit message_end event.
   */
  emitMessageEnd(
    messageId: string,
    role: MessageEndEvent["role"],
    content: string,
    tokenCount?: number
  ): void {
    this.emit({
      type: "message_end",
      messageId,
      role,
      content,
      agentId: this.agentId,
      sessionId: this.sessionId,
      tokenCount,
      timestamp: new Date(),
    });
  }

  /**
   * Emit tool_execution_start event.
   */
  emitToolExecutionStart(
    toolName: string,
    args: Record<string, unknown>
  ): string {
    this.phase = "tool_execution";
    this.toolCount++;

    const toolCallId = `tool_${this.toolCount}_${Date.now()}`;

    this.emit({
      type: "tool_execution_start",
      toolCallId,
      toolName,
      args,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });

    return toolCallId;
  }

  /**
   * Emit tool_execution_update event.
   */
  emitToolExecutionUpdate(toolCallId: string, partialResult: unknown): void {
    this.emit({
      type: "tool_execution_update",
      toolCallId,
      partialResult,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });
  }

  /**
   * Emit tool_execution_end event.
   */
  emitToolExecutionEnd(
    toolCallId: string,
    toolName: string,
    result: unknown,
    durationMs: number,
    success: boolean
  ): void {
    this.phase = "streaming";

    this.emit({
      type: "tool_execution_end",
      toolCallId,
      toolName,
      result,
      durationMs,
      success,
      agentId: this.agentId,
      sessionId: this.sessionId,
      timestamp: new Date(),
    });
  }

  /**
   * Get statistics.
   */
  getStats(): {
    agentId: string;
    sessionId: string;
    phase: AgentPhase;
    messageCount: number;
    toolCount: number;
    turnCount: number;
    durationMs?: number;
  } {
    return {
      agentId: this.agentId,
      sessionId: this.sessionId,
      phase: this.phase,
      messageCount: this.messageCount,
      toolCount: this.toolCount,
      turnCount: this.turnCount,
      durationMs: this.startTime ? Date.now() - this.startTime.getTime() : undefined,
    };
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.phase = "idle";
    this.messageCount = 0;
    this.toolCount = 0;
    this.turnCount = 0;
    this.startTime = undefined;
    this.turnStartTime = undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let lifecycleInstance: AgentLifecycleManager | null = null;

/**
 * Get or create the singleton lifecycle manager.
 */
export function getAgentLifecycleManager(
  agentId?: string,
  sessionId?: string
): AgentLifecycleManager {
  if (!lifecycleInstance) {
    lifecycleInstance = new AgentLifecycleManager(
      agentId ?? "main",
      sessionId ?? "default"
    );
  }
  return lifecycleInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetAgentLifecycleManager(): void {
  lifecycleInstance = null;
}
