/**
 * Enhanced AgentHarness — Extended with missing features from pi/opencode
 *
 * Adds to existing AgentHarness:
 * - Provider hooks (before_provider_request, before_provider_payload, after_provider_response)
 * - Pending write queue for session mutations during busy state
 * - Turn snapshots for immutable state per turn
 * - Save points for deterministic flush ordering
 * - Missing lifecycle events (queue_update, save_point, settled, model_select, etc.)
 * - Queue modes (one-at-a-time vs all)
 * - Proper abort handling with queue clearing
 */

import { EventEmitter } from "events";
import logger from "@/utils/logger.js";
import {
  AgentHarnessError,
  normalizeHarnessError,
  normalizeHookError,
  type AgentHarnessErrorCode,
} from "@/session/errors.js";
import {
  JsonlSessionStorage,
  type SessionTreeEntry,
  type PendingSessionWrite,
  PendingWriteQueue,
} from "@/session/jsonl-storage.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentHarnessPhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary"
  | "retry";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ToolExecutionMode = "parallel" | "sequential";

export type QueueMode = "one-at-a-time" | "all";

export type StreamFn = (
  model: ModelConfig,
  context: StreamContext,
  options?: StreamOptions
) => AsyncIterable<StreamChunk>;

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

export interface StreamContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}

export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  cacheRetention?: string;
  transport?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxRetryDelayMs?: number;
}

export interface StreamChunk {
  type: "text" | "tool_use" | "thinking" | "error";
  text?: string;
  toolCall?: ToolCall;
  thinking?: string;
  error?: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: ToolUseContext) => Promise<ToolResult>;
}

export interface ToolUseContext {
  agentId: string;
  sessionId: string;
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  content: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Options Patch (for provider hooks)
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamOptionsPatch extends Partial<Omit<StreamOptions, "headers" | "metadata">> {
  headers?: Record<string, string | undefined>;
  metadata?: Record<string, unknown | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle Events (Enhanced)
// ─────────────────────────────────────────────────────────────────────────────

export type LifecycleEvent =
  // Existing events
  | { type: "agent_start"; agentId: string; sessionId: string; timestamp: Date }
  | { type: "agent_end"; agentId: string; sessionId: string; messageCount: number; durationMs: number; timestamp: Date }
  | { type: "turn_start"; turnId: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "turn_end"; turnId: string; agentId: string; sessionId: string; toolResults: ToolResult[]; durationMs: number; timestamp: Date }
  | { type: "message_start"; messageId: string; role: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "message_update"; messageId: string; delta: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "message_end"; messageId: string; role: string; content: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult; durationMs: number; agentId: string; sessionId: string; timestamp: Date }
  // New events from pi
  | { type: "queue_update"; steer: AgentMessage[]; followUp: AgentMessage[]; nextTurn: AgentMessage[] }
  | { type: "save_point"; hadPendingMutations: boolean }
  | { type: "abort"; clearedSteer: AgentMessage[]; clearedFollowUp: AgentMessage[] }
  | { type: "settled"; nextTurnCount: number }
  | { type: "model_select"; model: ModelConfig; previousModel: ModelConfig | undefined; source: "set" | "restore" }
  | { type: "thinking_level_select"; level: ThinkingLevel; previousLevel: ThinkingLevel }
  | { type: "resources_update"; resources: AgentHarnessResources; previousResources: AgentHarnessResources }
  // Provider hooks
  | { type: "before_provider_request"; model: ModelConfig; sessionId: string; streamOptions: StreamOptions }
  | { type: "before_provider_payload"; model: ModelConfig; payload: unknown }
  | { type: "after_provider_response"; status: number; headers: Record<string, string> }
  // Tool hooks
  | { type: "tool_call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; toolName: string; input: Record<string, unknown>; content: string; details: unknown; isError: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

export interface PromptTemplate {
  name: string;
  description?: string;
  content: string;
}

export interface AgentHarnessResources {
  skills?: Skill[];
  promptTemplates?: PromptTemplate[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BeforeProviderRequestResult {
  streamOptions?: StreamOptionsPatch;
}

export interface BeforeProviderPayloadResult {
  payload: unknown;
}

export interface ToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultPatch {
  content?: string;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface AbortResult {
  clearedSteer: AgentMessage[];
  clearedFollowUp: AgentMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn Snapshot
// ─────────────────────────────────────────────────────────────────────────────

export interface TurnSnapshot {
  messages: AgentMessage[];
  systemPrompt: string;
  model: ModelConfig;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  activeToolNames: string[];
  streamOptions: StreamOptions;
  sessionId: string;
  resources: AgentHarnessResources;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentHarnessEnhanced Class
// ─────────────────────────────────────────────────────────────────────────────

export class AgentHarnessEnhanced {
  private emitter = new EventEmitter();
  private _phase: AgentHarnessPhase = "idle";
  private _abortController: AbortController | null = null;
  private _runPromise: Promise<void> | undefined;
  private _pendingSessionWrites: PendingSessionWrite[] = [];
  private _pendingToolCalls: Set<string> = new Set();
  private _messages: AgentMessage[] = [];
  private _turnCount = 0;
  private _messageCount = 0;
  private _startTime?: Date;

  // Configuration
  private _model: ModelConfig;
  private _thinkingLevel: ThinkingLevel = "off";
  private _toolExecutionMode: ToolExecutionMode = "parallel";
  private _systemPrompt: string | ((context: any) => string | Promise<string>) = "";
  private _sessionId: string;
  private _agentId: string;
  private _tools: Map<string, AgentTool> = new Map();
  private _activeToolNames: string[] = [];
  private _streamFn?: StreamFn;
  private _streamOptions: StreamOptions = {};
  private _resources: AgentHarnessResources = {};

  // Queues
  private _steerQueue: AgentMessage[] = [];
  private _followUpQueue: AgentMessage[] = [];
  private _nextTurnQueue: AgentMessage[] = [];
  private _steeringQueueMode: QueueMode = "one-at-a-time";
  private _followUpQueueMode: QueueMode = "one-at-a-time";

  // Session
  private _session?: JsonlSessionStorage;

  // API key resolver
  private _getApiKeyAndHeaders?: (model: ModelConfig) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;

  constructor(options: {
    agentId: string;
    sessionId: string;
    model?: ModelConfig;
    systemPrompt?: string | ((context: any) => string | Promise<string>);
    tools?: AgentTool[];
    streamFn?: StreamFn;
    session?: JsonlSessionStorage;
    streamOptions?: StreamOptions;
    resources?: AgentHarnessResources;
    getApiKeyAndHeaders?: (model: ModelConfig) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;
    steeringMode?: QueueMode;
    followUpMode?: QueueMode;
  }) {
    this._agentId = options.agentId;
    this._sessionId = options.sessionId;
    this._model = options.model ?? {
      id: "default",
      name: "Default Model",
      provider: "default",
      maxTokens: 4096,
      supportsStreaming: true,
      supportsThinking: false,
    };
    this._systemPrompt = options.systemPrompt ?? "";
    this._tools = new Map((options.tools ?? []).map((t) => [t.name, t]));
    this._activeToolNames = options.tools?.map((t) => t.name) ?? [];
    this._streamFn = options.streamFn;
    this._session = options.session;
    this._streamOptions = options.streamOptions ?? {};
    this._resources = options.resources ?? {};
    this._getApiKeyAndHeaders = options.getApiKeyAndHeaders;
    this._steeringQueueMode = options.steeringMode ?? "one-at-a-time";
    this._followUpQueueMode = options.followUpMode ?? "one-at-a-time";

    this.emitter.setMaxListeners(100);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get phase(): AgentHarnessPhase { return this._phase; }
  get isBusy(): boolean { return this._phase !== "idle"; }
  get messages(): AgentMessage[] { return [...this._messages]; }
  get model(): ModelConfig { return { ...this._model }; }
  get thinkingLevel(): ThinkingLevel { return this._thinkingLevel; }
  get toolExecutionMode(): ToolExecutionMode { return this._toolExecutionMode; }
  get systemPrompt(): string | ((context: any) => string | Promise<string>) { return this._systemPrompt; }
  get sessionId(): string { return this._sessionId; }
  get agentId(): string { return this._agentId; }
  get tools(): AgentTool[] { return Array.from(this._tools.values()); }
  get activeToolNames(): string[] { return [...this._activeToolNames]; }
  get streamOptions(): StreamOptions { return { ...this._streamOptions }; }
  get resources(): AgentHarnessResources { return { ...this._resources }; }
  get steeringQueueMode(): QueueMode { return this._steeringQueueMode; }
  get followUpQueueMode(): QueueMode { return this._followUpQueueMode; }

  // ── Setters ────────────────────────────────────────────────────────────────

  async setModel(model: ModelConfig): Promise<void> {
    try {
      const previousModel = this._model;
      if (this._phase === "idle" && this._session) {
        await this._session.appendEntry({
          type: "model_change",
          id: await this._session.createEntryId(),
          parentId: null,
          timestamp: new Date().toISOString(),
          provider: model.provider,
          modelId: model.id,
        });
      } else {
        this._pendingSessionWrites.push({
          type: "model_change",
          data: { provider: model.provider, modelId: model.id },
        });
      }
      this._model = model;
      this.emit({ type: "model_select", model, previousModel, source: "set" });
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    try {
      const previousLevel = this._thinkingLevel;
      if (this._phase === "idle" && this._session) {
        await this._session.appendEntry({
          type: "thinking_level_change",
          id: await this._session.createEntryId(),
          parentId: null,
          timestamp: new Date().toISOString(),
          thinkingLevel: level,
        });
      } else {
        this._pendingSessionWrites.push({
          type: "thinking_level_change",
          data: { thinkingLevel: level },
        });
      }
      this._thinkingLevel = level;
      this.emit({ type: "thinking_level_select", level, previousLevel });
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  async setResources(resources: AgentHarnessResources): Promise<void> {
    const previousResources = this._resources;
    this._resources = { ...resources };
    this.emit({ type: "resources_update", resources, previousResources });
  }

  async setTools(tools: AgentTool[], activeToolNames?: string[]): Promise<void> {
    this._tools = new Map(tools.map((t) => [t.name, t]));
    if (activeToolNames) {
      this._activeToolNames = [...activeToolNames];
    }
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    const missing = toolNames.filter((name) => !this._tools.has(name));
    if (missing.length > 0) {
      throw new AgentHarnessError("invalid_argument", `Unknown tool(s): ${missing.join(", ")}`);
    }
    this._activeToolNames = [...toolNames];
  }

  setSteeringMode(mode: QueueMode): void {
    this._steeringQueueMode = mode;
  }

  setFollowUpMode(mode: QueueMode): void {
    this._followUpQueueMode = mode;
  }

  // ── Event Subscription ─────────────────────────────────────────────────────

  on<T extends LifecycleEvent>(
    eventType: T["type"],
    listener: (event: T) => void | Promise<void>
  ): () => void {
    this.emitter.on(eventType, listener);
    return () => { this.emitter.off(eventType, listener); };
  }

  subscribe(listener: (event: LifecycleEvent) => void | Promise<void>): () => void {
    const wrapper = (event: LifecycleEvent) => listener(event);
    this.emitter.on("*", wrapper);
    return () => { this.emitter.off("*", wrapper); };
  }

  private emit(event: LifecycleEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  private async emitHook<TType extends keyof HookEventResultMap>(
    event: { type: TType } & Record<string, unknown>,
  ): Promise<HookEventResultMap[TType] | undefined> {
    const handlers = this.emitter.listeners(event.type) as Array<(event: any) => Promise<any> | any>;
    if (handlers.length === 0) return undefined;
    
    let lastResult: HookEventResultMap[TType] | undefined;
    for (const handler of handlers) {
      try {
        const result = await handler(event);
        if (result !== undefined) {
          lastResult = result;
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return lastResult;
  }

  // ── Prompting ──────────────────────────────────────────────────────────────

  async prompt(text: string, options?: { images?: unknown[] }): Promise<void> {
    if (this._phase !== "idle") {
      throw new AgentHarnessError("busy", "AgentHarness is busy");
    }
    
    this._phase = "turn";
    this._abortController = new AbortController();
    this._startTime = new Date();
    this._turnCount = 0;

    const userMessage: AgentMessage = {
      id: `msg_${++this._messageCount}_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    this._messages.push(userMessage);

    // Emit agent_start
    this.emit({
      type: "agent_start",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    // Process next-turn queue
    if (this._nextTurnQueue.length > 0) {
      const queuedMessages = this._nextTurnQueue.splice(0);
      this._messages.unshift(...queuedMessages);
      await this.emitQueueUpdate();
    }

    // Emit before_agent_start hook
    const beforeResult = await this.emitHook({
      type: "before_agent_start" as any,
      prompt: text,
      images: options?.images,
      systemPrompt: await this.resolveSystemPrompt(),
      resources: this._resources,
    });

    await this.runLoop();
  }

  async continue(): Promise<void> {
    if (this._phase !== "idle") {
      throw new AgentHarnessError("busy", "AgentHarness is busy");
    }

    this._phase = "turn";
    this._abortController = new AbortController();
    this._startTime = new Date();

    this.emit({
      type: "agent_start",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    await this.runLoop();
  }

  // ── Control ────────────────────────────────────────────────────────────────

  async abort(): Promise<AbortResult> {
    const clearedSteer = [...this._steerQueue];
    const clearedFollowUp = [...this._followUpQueue];
    this._steerQueue = [];
    this._followUpQueue = [];
    
    this._abortController?.abort();
    
    await this.emitQueueUpdate();
    await this.waitForIdle();
    
    this.emit({ type: "abort", clearedSteer, clearedFollowUp });
    
    return { clearedSteer, clearedFollowUp };
  }

  async waitForIdle(): Promise<void> {
    await this._runPromise;
  }

  // ── Steering ───────────────────────────────────────────────────────────────

  async steer(text: string, options?: { images?: unknown[] }): Promise<void> {
    if (this._phase === "idle") {
      throw new AgentHarnessError("invalid_state", "Cannot steer while idle");
    }
    this._steerQueue.push({
      id: `msg_${++this._messageCount}_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    });
    await this.emitQueueUpdate();
  }

  async followUp(text: string, options?: { images?: unknown[] }): Promise<void> {
    if (this._phase === "idle") {
      throw new AgentHarnessError("invalid_state", "Cannot follow up while idle");
    }
    this._followUpQueue.push({
      id: `msg_${++this._messageCount}_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    });
    await this.emitQueueUpdate();
  }

  async nextTurn(text: string, options?: { images?: unknown[] }): Promise<void> {
    this._nextTurnQueue.push({
      id: `msg_${++this._messageCount}_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    });
    await this.emitQueueUpdate();
  }

  // ── Queue Management ───────────────────────────────────────────────────────

  private async emitQueueUpdate(): Promise<void> {
    this.emit({
      type: "queue_update",
      steer: [...this._steerQueue],
      followUp: [...this._followUpQueue],
      nextTurn: [...this._nextTurnQueue],
    });
  }

  private async drainQueuedMessages(queue: AgentMessage[], mode: QueueMode): Promise<AgentMessage[]> {
    const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
    if (messages.length === 0) return messages;
    try {
      await this.emitQueueUpdate();
      return messages;
    } catch (error) {
      queue.unshift(...messages);
      throw normalizeHookError(error);
    }
  }

  // ── Session Writes ─────────────────────────────────────────────────────────

  async appendMessage(message: AgentMessage): Promise<void> {
    try {
      if (this._phase === "idle" && this._session) {
        await this._session.appendEntry({
          type: "message",
          id: await this._session.createEntryId(),
          parentId: null,
          timestamp: new Date().toISOString(),
          message: {
            role: message.role,
            content: message.content,
            timestamp: message.timestamp.toISOString(),
            metadata: message.metadata,
          },
        });
      } else {
        this._pendingSessionWrites.push({
          type: "message",
          data: {
            message: {
              role: message.role,
              content: message.content,
              timestamp: message.timestamp.toISOString(),
              metadata: message.metadata,
            },
          },
        });
      }
    } catch (error) {
      throw normalizeHarnessError(error, "session");
    }
  }

  private async flushPendingSessionWrites(): Promise<void> {
    while (this._pendingSessionWrites.length > 0) {
      const write = this._pendingSessionWrites[0]!;
      if (!this._session) {
        this._pendingSessionWrites.shift();
        continue;
      }
      
      try {
        const entry: SessionTreeEntry = {
          ...write.data,
          id: await this._session.createEntryId(),
          parentId: null,
          timestamp: new Date().toISOString(),
        } as SessionTreeEntry;
        
        await this._session.appendEntry(entry);
        this._pendingSessionWrites.shift();
      } catch (error) {
        logger.error("[AgentHarness] Failed to flush pending write:", error);
        break;
      }
    }
  }

  // ── Compaction ─────────────────────────────────────────────────────────────

  /**
   * Compact the session context
   * 
   * Summarizes old messages to keep token usage within budget.
   * Based on pi's compact() implementation.
   */
  async compact(
    customInstructions?: string,
  ): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown }> {
    if (this._phase !== "idle") {
      throw new AgentHarnessError("busy", "compact() requires idle harness");
    }
    
    this._phase = "compaction";
    
    try {
      const model = this._model;
      if (!model) {
        throw new AgentHarnessError("invalid_state", "No model set for compaction");
      }

      // Get API key if available
      const auth = await this._getApiKeyAndHeaders?.(model);

      // Get branch entries from session
      const branchEntries = this._session ? await this._session.getEntries() : [];
      
      // Prepare compaction
      const { prepareCompaction, generateCompactionSummary } = await import("../session/compaction-enhanced.js");
      const preparationResult = prepareCompaction(branchEntries);
      
      if (!preparationResult.ok) {
        throw preparationResult.error;
      }
      
      const preparation = preparationResult.value;
      if (!preparation) {
        throw new AgentHarnessError("compaction", "Nothing to compact");
      }

      // Emit session_before_compact hook
      const hookResult = await this.emitHook({
        type: "session_before_compact" as any,
        preparation,
        branchEntries,
        customInstructions,
        signal: new AbortController().signal,
      });

      if (hookResult?.cancel) {
        throw new AgentHarnessError("compaction", "Compaction cancelled");
      }

      // Use provided compaction or generate new one
      const provided = hookResult?.compaction;
      let result: { summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown };
      
      if (provided) {
        result = provided;
      } else {
        const compactResult = await generateCompactionSummary(preparation, {
          model,
          apiKey: auth?.apiKey,
          customInstructions,
        });
        
        if (!compactResult.ok) {
          throw compactResult.error;
        }
        result = compactResult.value;
      }

      // Persist compaction entry
      if (this._session) {
        const entryId = await this._session.appendEntry({
          type: "compaction",
          id: await this._session.createEntryId(),
          parentId: null,
          timestamp: new Date().toISOString(),
          summary: result.summary,
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
          details: result.details,
          fromHook: provided !== undefined,
        });

        // Emit session_compact event
        const entry = await this._session.getEntry(entryId);
        if (entry?.type === "compaction") {
          this.emit({
            type: "session_compact" as any,
            compactionEntry: entry,
            fromHook: provided !== undefined,
          });
        }
      }

      return result;
    } catch (error) {
      throw normalizeHarnessError(error, "compaction");
    } finally {
      this._phase = "idle";
    }
  }

  // ── System Prompt Resolution ───────────────────────────────────────────────

  private async resolveSystemPrompt(): Promise<string> {
    if (typeof this._systemPrompt === "string") {
      return this._systemPrompt;
    }
    
    try {
      return await this._systemPrompt({
        env: process.env,
        session: this._session,
        model: this._model,
        thinkingLevel: this._thinkingLevel,
        activeTools: this._activeToolNames.map((name) => this._tools.get(name)).filter(Boolean),
        resources: this._resources,
      });
    } catch (error) {
      throw new AgentHarnessError("hook", "System prompt callback failed", error instanceof Error ? error : undefined);
    }
  }

  // ── Internal Loop ──────────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    const finishRunPromise = this.startRunPromise();
    
    try {
      while (this._phase !== "idle") {
        // Check for abort
        if (this._abortController?.signal.aborted) {
          break;
        }

        // Check for steering messages
        const steeringMessages = await this.drainQueuedMessages(this._steerQueue, this._steeringQueueMode);
        if (steeringMessages.length > 0) {
          this._messages.push(...steeringMessages);
        }

        // Start new turn
        this._turnCount++;
        const turnId = `turn_${this._turnCount}_${Date.now()}`;
        const turnStartTime = Date.now();

        this.emit({
          type: "turn_start",
          turnId,
          agentId: this._agentId,
          sessionId: this._sessionId,
          timestamp: new Date(),
        });

        // Create turn snapshot
        const turnSnapshot = await this.createTurnSnapshot();

        // Stream response
        const toolResults: ToolResult[] = [];
        
        if (this._streamFn) {
          await this.streamResponse(toolResults, turnSnapshot);
        } else {
          break;
        }

        // Emit turn_end
        this.emit({
          type: "turn_end",
          turnId,
          agentId: this._agentId,
          sessionId: this._sessionId,
          toolResults,
          durationMs: Date.now() - turnStartTime,
          timestamp: new Date(),
        });

        // Save point
        await this.flushPendingSessionWrites();
        this.emit({ type: "save_point", hadPendingMutations: this._pendingSessionWrites.length > 0 });

        // Check for follow-up messages
        if (this._followUpQueue.length > 0 && this._pendingToolCalls.size === 0) {
          const followUpMessages = await this.drainQueuedMessages(this._followUpQueue, this._followUpQueueMode);
          if (followUpMessages.length > 0) {
            this._messages.push(...followUpMessages);
            continue;
          }
        }

        // No more work
        break;
      }
    } catch (error) {
      logger.error("[AgentHarness] Loop error:", error);
      this._phase = "idle";
    } finally {
      // Emit agent_end
      const durationMs = this._startTime ? Date.now() - this._startTime.getTime() : 0;
      this.emit({
        type: "agent_end",
        agentId: this._agentId,
        sessionId: this._sessionId,
        messageCount: this._messageCount,
        durationMs,
        timestamp: new Date(),
      });

      // Emit settled
      this.emit({ type: "settled", nextTurnCount: this._nextTurnQueue.length });

      this._phase = "idle";
      this._abortController = null;
      finishRunPromise();
    }
  }

  private startRunPromise(): () => void {
    let finish = () => {};
    this._runPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return () => {
      this._runPromise = undefined;
      finish();
    };
  }

  private async createTurnSnapshot(): Promise<TurnSnapshot> {
    const systemPrompt = await this.resolveSystemPrompt();
    
    return {
      messages: [...this._messages],
      systemPrompt,
      model: { ...this._model },
      thinkingLevel: this._thinkingLevel,
      tools: Array.from(this._tools.values()),
      activeToolNames: [...this._activeToolNames],
      streamOptions: { ...this._streamOptions },
      sessionId: this._sessionId,
      resources: { ...this._resources },
    };
  }

  private async streamResponse(toolResults: ToolResult[], snapshot: TurnSnapshot): Promise<void> {
    if (!this._streamFn) return;

    // Emit before_provider_request hook
    const requestOptions = await this.emitHook({
      type: "before_provider_request",
      model: snapshot.model,
      sessionId: snapshot.sessionId,
      streamOptions: snapshot.streamOptions,
    });

    // Merge stream options
    const mergedOptions: StreamOptions = {
      ...snapshot.streamOptions,
      ...(requestOptions?.streamOptions ?? {}),
    };

    // Get API key if available
    const auth = await this._getApiKeyAndHeaders?.(snapshot.model);
    if (auth?.headers) {
      mergedOptions.headers = {
        ...mergedOptions.headers,
        ...auth.headers,
      };
    }

    const messageId = `msg_${++this._messageCount}_${Date.now()}`;
    let content = "";

    this.emit({
      type: "message_start",
      messageId,
      role: "assistant",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    try {
      const stream = this._streamFn(snapshot.model, {
        systemPrompt: snapshot.systemPrompt,
        messages: snapshot.messages,
        tools: snapshot.tools.filter((t) => snapshot.activeToolNames.includes(t.name)),
      }, {
        ...mergedOptions,
        signal: this._abortController?.signal,
      });

      for await (const chunk of stream) {
        if (this._abortController?.signal.aborted) break;

        switch (chunk.type) {
          case "text":
            if (chunk.text) {
              content += chunk.text;
              this.emit({
                type: "message_update",
                messageId,
                delta: chunk.text,
                agentId: this._agentId,
                sessionId: this._sessionId,
                timestamp: new Date(),
              });
            }
            break;
          case "tool_use":
            if (chunk.toolCall) {
              await this.handleToolCall(chunk.toolCall, toolResults);
            }
            break;
        }
      }
    } catch (error) {
      logger.error("[AgentHarness] Stream error:", error);
    }

    // Add assistant message
    const assistantMessage: AgentMessage = {
      id: messageId,
      role: "assistant",
      content,
      timestamp: new Date(),
    };
    this._messages.push(assistantMessage);

    // Persist message
    await this.appendMessage(assistantMessage);

    this.emit({
      type: "message_end",
      messageId,
      role: "assistant",
      content,
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });
  }

  private async handleToolCall(toolCall: ToolCall, toolResults: ToolResult[]): Promise<void> {
    this._pendingToolCalls.add(toolCall.id);

    // Emit tool_call hook
    await this.emitHook({
      type: "tool_call",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.args,
    });

    this.emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    const tool = this._tools.get(toolCall.name);
    let result: ToolResult;

    if (tool) {
      const startTime = Date.now();
      try {
        result = await tool.execute(toolCall.args, {
          agentId: this._agentId,
          sessionId: this._sessionId,
          cwd: process.cwd(),
          signal: this._abortController?.signal,
        });
      } catch (error) {
        result = { content: "", error: String(error) };
      }

      // Emit tool_result hook
      const patch = await this.emitHook({
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
        content: result.content,
        details: result.metadata,
        isError: !!result.error,
      });

      // Apply patch if provided
      if (patch) {
        if (patch.content !== undefined) result.content = patch.content;
        if (patch.isError !== undefined) result.error = patch.isError ? (result.error ?? "Error") : undefined;
      }

      this.emit({
        type: "tool_execution_end",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        durationMs: Date.now() - startTime,
        agentId: this._agentId,
        sessionId: this._sessionId,
        timestamp: new Date(),
      });

      toolResults.push(result);
    } else {
      result = { content: "", error: `Unknown tool: ${toolCall.name}` };
      toolResults.push(result);
    }

    this._pendingToolCalls.delete(toolCall.id);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats(): {
    agentId: string;
    sessionId: string;
    phase: AgentHarnessPhase;
    turnCount: number;
    messageCount: number;
    pendingToolCalls: number;
    pendingWrites: number;
    durationMs?: number;
  } {
    return {
      agentId: this._agentId,
      sessionId: this._sessionId,
      phase: this._phase,
      turnCount: this._turnCount,
      messageCount: this._messageCount,
      pendingToolCalls: this._pendingToolCalls.size,
      pendingWrites: this._pendingSessionWrites.length,
      durationMs: this._startTime ? Date.now() - this._startTime.getTime() : undefined,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Event Result Map
// ─────────────────────────────────────────────────────────────────────────────

interface HookEventResultMap {
  before_provider_request: BeforeProviderRequestResult | undefined;
  before_provider_payload: BeforeProviderPayloadResult | undefined;
  after_provider_response: undefined;
  tool_call: ToolCallResult | undefined;
  tool_result: ToolResultPatch | undefined;
  before_agent_start: { messages?: AgentMessage[]; systemPrompt?: string } | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createEnhancedAgentHarness(options: {
  agentId?: string;
  sessionId?: string;
  model?: ModelConfig;
  systemPrompt?: string | ((context: any) => string | Promise<string>);
  tools?: AgentTool[];
  streamFn?: StreamFn;
  session?: JsonlSessionStorage;
  streamOptions?: StreamOptions;
  resources?: AgentHarnessResources;
  getApiKeyAndHeaders?: (model: ModelConfig) => Promise<{ apiKey: string; headers?: Record<string, string> } | undefined>;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
}): AgentHarnessEnhanced {
  return new AgentHarnessEnhanced({
    agentId: options.agentId ?? "main",
    sessionId: options.sessionId ?? "default",
    ...options,
  });
}
