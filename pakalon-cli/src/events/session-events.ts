/**
 * Session Events System — typed event catalog for extensions and components.
 *
 * Provides a structured event bus that:
 * - Extensions can subscribe to via JSON-RPC
 * - Components can observe via typed listeners
 * - Supports wildcard subscriptions
 * - Provides unsubscribe functions
 *
 * Matches Copilot CLI's session.on() event model.
 */
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

export type SessionEventType =
  | "assistant.message"
  | "assistant.turn_start"
  | "assistant.turn_end"
  | "tool.execution_start"
  | "tool.execution_complete"
  | "tool.execution_error"
  | "user.message"
  | "session.start"
  | "session.idle"
  | "session.error"
  | "session.shutdown"
  | "session.compaction"
  | "permission.requested"
  | "permission.decided"
  | "extension.loaded"
  | "extension.unloaded"
  | "extension.error"
  // New events from harness.md implementation
  | "harness.queue_update"
  | "harness.save_point"
  | "harness.abort"
  | "harness.settled"
  | "harness.model_select"
  | "harness.thinking_level_select"
  | "harness.resources_update"
  | "harness.session_before_compact"
  | "harness.session_compact"
  | "harness.session_before_tree"
  | "harness.session_tree"
  | "provider.before_request"
  | "provider.before_payload"
  | "provider.after_response";

// ---------------------------------------------------------------------------
// Event Data Types
// ---------------------------------------------------------------------------

export interface AssistantMessageEvent {
  type: "assistant.message";
  messageId: string;
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  sessionId?: string;
}

export interface ToolExecutionStartEvent {
  type: "tool.execution_start";
  toolName: string;
  toolArgs: Record<string, unknown>;
  executionId: string;
  sessionId?: string;
}

export interface ToolExecutionCompleteEvent {
  type: "tool.execution_complete";
  toolName: string;
  executionId: string;
  duration: number;
  success: boolean;
  sessionId?: string;
}

export interface ToolExecutionErrorEvent {
  type: "tool.execution_error";
  toolName: string;
  executionId: string;
  error: string;
  sessionId?: string;
}

export interface UserMessageEvent {
  type: "user.message";
  messageId: string;
  content: string;
  sessionId?: string;
}

export interface SessionStartEvent {
  type: "session.start";
  sessionId: string;
  workingDirectory: string;
  model: string;
}

export interface SessionIdleEvent {
  type: "session.idle";
  sessionId: string;
  lastActivity: string;
}

export interface SessionErrorEvent {
  type: "session.error";
  sessionId: string;
  error: string;
  recoverable: boolean;
}

export interface SessionShutdownEvent {
  type: "session.shutdown";
  sessionId: string;
  reason: "user" | "error" | "timeout" | "compaction";
}

export interface PermissionRequestedEvent {
  type: "permission.requested";
  requestId: string;
  toolName: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface PermissionDecidedEvent {
  type: "permission.decided";
  requestId: string;
  toolName: string;
  allowed: boolean;
  mode: "once" | "session" | "always" | "deny";
}

export interface ExtensionLoadedEvent {
  type: "extension.loaded";
  extensionName: string;
  tools: string[];
  hooks: string[];
}

export interface ExtensionUnloadedEvent {
  type: "extension.unloaded";
  extensionName: string;
  reason: "manual" | "error" | "reload";
}

export interface ExtensionErrorEvent {
  type: "extension.error";
  extensionName: string;
  error: string;
  recoverable: boolean;
}

export interface SessionCompactionEvent {
  type: "session.compaction";
  originalMessageCount: number;
  newMessageCount: number;
  tokensSaved: number;
}

export interface TurnStartEvent {
  type: "assistant.turn_start";
  turnId: string;
  sessionId?: string;
}

export interface TurnEndEvent {
  type: "assistant.turn_end";
  turnId: string;
  duration: number;
  tokenCount: number;
  sessionId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// New Events from harness.md implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface QueueUpdateEvent {
  type: "harness.queue_update";
  steer: Array<{ id: string; role: string; content: string }>;
  followUp: Array<{ id: string; role: string; content: string }>;
  nextTurn: Array<{ id: string; role: string; content: string }>;
  sessionId?: string;
}

export interface SavePointEvent {
  type: "harness.save_point";
  hadPendingMutations: boolean;
  sessionId?: string;
}

export interface AbortEvent {
  type: "harness.abort";
  clearedSteer: Array<{ id: string; role: string; content: string }>;
  clearedFollowUp: Array<{ id: string; role: string; content: string }>;
  sessionId?: string;
}

export interface SettledEvent {
  type: "harness.settled";
  nextTurnCount: number;
  sessionId?: string;
}

export interface ModelSelectEvent {
  type: "harness.model_select";
  model: { id: string; name: string; provider: string };
  previousModel?: { id: string; name: string; provider: string };
  source: "set" | "restore";
  sessionId?: string;
}

export interface ThinkingLevelSelectEvent {
  type: "harness.thinking_level_select";
  level: string;
  previousLevel: string;
  sessionId?: string;
}

export interface ResourcesUpdateEvent {
  type: "harness.resources_update";
  resources: { skills?: unknown[]; promptTemplates?: unknown[] };
  previousResources: { skills?: unknown[]; promptTemplates?: unknown[] };
  sessionId?: string;
}

export interface SessionBeforeCompactEvent {
  type: "harness.session_before_compact";
  preparation: unknown;
  branchEntries: unknown[];
  customInstructions?: string;
  sessionId?: string;
}

export interface SessionCompactEvent {
  type: "harness.session_compact";
  compactionEntry: unknown;
  fromHook: boolean;
  sessionId?: string;
}

export interface SessionBeforeTreeEvent {
  type: "harness.session_before_tree";
  preparation: unknown;
  sessionId?: string;
}

export interface SessionTreeEvent {
  type: "harness.session_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: unknown;
  fromHook?: boolean;
  sessionId?: string;
}

export interface ProviderBeforeRequestEvent {
  type: "provider.before_request";
  model: { id: string; provider: string };
  sessionId: string;
  streamOptions: unknown;
}

export interface ProviderBeforePayloadEvent {
  type: "provider.before_payload";
  model: { id: string; provider: string };
  payload: unknown;
}

export interface ProviderAfterResponseEvent {
  type: "provider.after_response";
  status: number;
  headers: Record<string, string>;
}

// Union type for all events
export type SessionEvent =
  | AssistantMessageEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionCompleteEvent
  | ToolExecutionErrorEvent
  | UserMessageEvent
  | SessionStartEvent
  | SessionIdleEvent
  | SessionErrorEvent
  | SessionShutdownEvent
  | PermissionRequestedEvent
  | PermissionDecidedEvent
  | ExtensionLoadedEvent
  | ExtensionUnloadedEvent
  | ExtensionErrorEvent
  | SessionCompactionEvent
  // New events
  | QueueUpdateEvent
  | SavePointEvent
  | AbortEvent
  | SettledEvent
  | ModelSelectEvent
  | ThinkingLevelSelectEvent
  | ResourcesUpdateEvent
  | SessionBeforeCompactEvent
  | SessionCompactEvent
  | SessionBeforeTreeEvent
  | SessionTreeEvent
  | ProviderBeforeRequestEvent
  | ProviderBeforePayloadEvent
  | ProviderAfterResponseEvent;

// ---------------------------------------------------------------------------
// Event Listener Types
// ---------------------------------------------------------------------------

export type SessionEventListener<T extends SessionEvent = SessionEvent> = (event: T) => void;
export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Session Event Bus
// ---------------------------------------------------------------------------

export class SessionEventBus {
  private emitter = new EventEmitter();
  private eventLog: SessionEvent[] = [];
  private maxLogSize = 1000;

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on<T extends SessionEventType>(
    eventType: T,
    listener: SessionEventListener<Extract<SessionEvent, { type: T }>>
  ): Unsubscribe {
    this.emitter.on(eventType, listener);
    return () => this.emitter.off(eventType, listener);
  }

  /**
   * Subscribe to all events (wildcard).
   * Returns an unsubscribe function.
   */
  onAll(listener: SessionEventListener): Unsubscribe {
    const wrapper = (event: SessionEvent) => listener(event);
    for (const eventType of this.getAllEventTypes()) {
      this.emitter.on(eventType, wrapper);
    }
    return () => {
      for (const eventType of this.getAllEventTypes()) {
        this.emitter.off(eventType, wrapper);
      }
    };
  }

  /**
   * Subscribe to an event once.
   */
  once<T extends SessionEventType>(
    eventType: T,
    listener: SessionEventListener<Extract<SessionEvent, { type: T }>>
  ): Unsubscribe {
    this.emitter.once(eventType, listener);
    return () => this.emitter.off(eventType, listener);
  }

  /**
   * Emit an event.
   */
  emit(event: SessionEvent): void {
    // Store in event log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event); // Wildcard
  }

  /**
   * Get the event log (most recent events).
   */
  getEventLog(count?: number): SessionEvent[] {
    if (count) return this.eventLog.slice(-count);
    return [...this.eventLog];
  }

  /**
   * Get events of a specific type from the log.
   */
  getEventsByType<T extends SessionEventType>(
    eventType: T,
    count?: number
  ): Array<Extract<SessionEvent, { type: T }>> {
    const filtered = this.eventLog.filter(
      (e): e is Extract<SessionEvent, { type: T }> => e.type === eventType
    );
    if (count) return filtered.slice(-count);
    return filtered;
  }

  /**
   * Clear the event log.
   */
  clearLog(): void {
    this.eventLog = [];
  }

  /**
   * Remove all listeners.
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Get listener count for an event type.
   */
  listenerCount(eventType: SessionEventType | "*"): number {
    return this.emitter.listenerCount(eventType);
  }

  private getAllEventTypes(): SessionEventType[] {
    return [
      "assistant.message",
      "assistant.turn_start",
      "assistant.turn_end",
      "tool.execution_start",
      "tool.execution_complete",
      "tool.execution_error",
      "user.message",
      "session.start",
      "session.idle",
      "session.error",
      "session.shutdown",
      "session.compaction",
      "permission.requested",
      "permission.decided",
      "extension.loaded",
      "extension.unloaded",
      "extension.error",
      // New events
      "harness.queue_update",
      "harness.save_point",
      "harness.abort",
      "harness.settled",
      "harness.model_select",
      "harness.thinking_level_select",
      "harness.resources_update",
      "harness.session_before_compact",
      "harness.session_compact",
      "harness.session_before_tree",
      "harness.session_tree",
      "provider.before_request",
      "provider.before_payload",
      "provider.after_response",
    ];
  }
}

// ---------------------------------------------------------------------------
// Global Event Bus (singleton)
// ---------------------------------------------------------------------------

let globalBus: SessionEventBus | null = null;

/**
 * Get the global session event bus.
 */
export function getSessionEventBus(): SessionEventBus {
  if (!globalBus) {
    globalBus = new SessionEventBus();
  }
  return globalBus;
}

/**
 * Reset the global event bus (for testing).
 */
export function resetSessionEventBus(): void {
  if (globalBus) {
    globalBus.removeAllListeners();
    globalBus = null;
  }
}
