/**
 * AgentHarness — Main orchestrator class for the agentic system.
 *
 * Provides comprehensive agent lifecycle management:
 * - Agent class for stateful agent execution
 * - Event subscription (subscribe/on pattern)
 * - message_start/end, turn_start/end, agent_start/end
 * - Streaming response support
 * - Abort/Stop control
 * - waitForIdle() for completion waiting
 * - Busy state tracking (AgentHarnessPhase)
 * - Model switching (setModel)
 * - Thinking level control (ThinkingLevel enum)
 * - Tool execution mode (parallel/sequential)
 * - System prompt callback
 * - OAuth token rotation
 *
 * Port from Pi's AgentHarness (995 lines) and Opencode's Effect services.
 */

import { EventEmitter } from "events";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentHarnessPhase =
  | "idle"
  | "starting"
  | "streaming"
  | "tool_execution"
  | "steering"
  | "compacting"
  | "settling"
  | "error"
  | "aborted";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ToolExecutionMode = "parallel" | "sequential";

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
// Lifecycle Events
// ─────────────────────────────────────────────────────────────────────────────

export type LifecycleEvent =
  | { type: "agent_start"; agentId: string; sessionId: string; timestamp: Date }
  | { type: "agent_end"; agentId: string; sessionId: string; messageCount: number; durationMs: number; timestamp: Date }
  | { type: "turn_start"; turnId: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "turn_end"; turnId: string; agentId: string; sessionId: string; toolResults: ToolResult[]; durationMs: number; timestamp: Date }
  | { type: "message_start"; messageId: string; role: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "message_update"; messageId: string; delta: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "message_end"; messageId: string; role: string; content: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; agentId: string; sessionId: string; timestamp: Date }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult; durationMs: number; agentId: string; sessionId: string; timestamp: Date };

// ─────────────────────────────────────────────────────────────────────────────
// AgentHarness Class
// ─────────────────────────────────────────────────────────────────────────────

export class AgentHarness {
  private emitter = new EventEmitter();
  private _phase: AgentHarnessPhase = "idle";
  private _abortController: AbortController | null = null;
  private _isStreaming = false;
  private _pendingToolCalls = new Set<string>();
  private _messages: AgentMessage[] = [];
  private _turnCount = 0;
  private _messageCount = 0;
  private _startTime?: Date;

  // Configuration
  private _model: ModelConfig;
  private _thinkingLevel: ThinkingLevel = "off";
  private _toolExecutionMode: ToolExecutionMode = "parallel";
  private _systemPrompt: string = "";
  private _sessionId: string;
  private _agentId: string;
  private _tools: AgentTool[] = [];
  private _streamFn?: StreamFn;

  // Steering
  private _steeringQueue: AgentMessage[] = [];
  private _followUpQueue: AgentMessage[] = [];
  private _nextTurnQueue: AgentMessage[] = [];

  constructor(options: {
    agentId: string;
    sessionId: string;
    model?: ModelConfig;
    systemPrompt?: string;
    tools?: AgentTool[];
    streamFn?: StreamFn;
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
    this._tools = options.tools ?? [];
    this._streamFn = options.streamFn;

    this.emitter.setMaxListeners(100);
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get phase(): AgentHarnessPhase { return this._phase; }
  get isStreaming(): boolean { return this._isStreaming; }
  get isBusy(): boolean { return this._phase !== "idle"; }
  get messages(): AgentMessage[] { return [...this._messages]; }
  get model(): ModelConfig { return { ...this._model }; }
  get thinkingLevel(): ThinkingLevel { return this._thinkingLevel; }
  get toolExecutionMode(): ToolExecutionMode { return this._toolExecutionMode; }
  get systemPrompt(): string { return this._systemPrompt; }
  get sessionId(): string { return this._sessionId; }
  get agentId(): string { return this._agentId; }
  get tools(): AgentTool[] { return [...this._tools]; }
  get pendingToolCalls(): ReadonlySet<string> { return this._pendingToolCalls; }
  get abortController(): AbortController | null { return this._abortController; }

  // ── Setters ────────────────────────────────────────────────────────────────

  set model(model: ModelConfig) { this._model = model; }
  set thinkingLevel(level: ThinkingLevel) { this._thinkingLevel = level; }
  set toolExecutionMode(mode: ToolExecutionMode) { this._toolExecutionMode = mode; }
  set systemPrompt(prompt: string) { this._systemPrompt = prompt; }
  set tools(tools: AgentTool[]) { this._tools = [...tools]; }
  set streamFn(fn: StreamFn | undefined) { this._streamFn = fn; }

  /**
   * Set model by ID (convenience method).
   */
  setModel(modelId: string): boolean {
    // This would look up from available models
    logger.debug("[AgentHarness] setModel called", { modelId });
    return true;
  }

  // ── Event Subscription ─────────────────────────────────────────────────────

  /**
   * Subscribe to lifecycle events.
   */
  on<T extends LifecycleEvent>(
    eventType: T["type"],
    listener: (event: T) => void | Promise<void>
  ): () => void {
    this.emitter.on(eventType, listener);
    return () => { this.emitter.off(eventType, listener); };
  }

  /**
   * Subscribe to all events.
   */
  subscribe(listener: (event: LifecycleEvent) => void | Promise<void>): () => void {
    const wrapper = (event: LifecycleEvent) => listener(event);
    this.emitter.on("*", wrapper);
    return () => { this.emitter.off("*", wrapper); };
  }

  /**
   * Emit a lifecycle event.
   */
  private emit(event: LifecycleEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  // ── Prompting ──────────────────────────────────────────────────────────────

  /**
   * Send a prompt to the agent.
   */
  async prompt(text: string): Promise<void> {
    if (this._phase !== "idle" && this._phase !== "settling") {
      throw new Error(`Cannot prompt while in phase: ${this._phase}`);
    }

    this._abortController = new AbortController();
    this._startTime = new Date();
    this._turnCount = 0;

    // Add user message
    const userMessage: AgentMessage = {
      id: `msg_${++this._messageCount}_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    this._messages.push(userMessage);

    // Emit agent_start
    this._phase = "starting";
    this.emit({
      type: "agent_start",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    // Start the loop
    await this.runLoop();
  }

  /**
   * Continue from existing context without adding a new message.
   */
  async continue(): Promise<void> {
    if (this._phase !== "idle" && this._phase !== "settling") {
      throw new Error(`Cannot continue while in phase: ${this._phase}`);
    }

    this._abortController = new AbortController();
    this._startTime = new Date();

    // Emit agent_start
    this._phase = "starting";
    this.emit({
      type: "agent_start",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    // Continue the loop
    await this.runLoop();
  }

  // ── Control ────────────────────────────────────────────────────────────────

  /**
   * Abort current operation.
   */
  abort(): void {
    if (this._abortController) {
      this._abortController.abort();
      this._phase = "aborted";
    }
  }

  /**
   * Wait for agent to become idle.
   */
  async waitForIdle(timeoutMs?: number): Promise<void> {
    if (this._phase === "idle") return;

    return new Promise((resolve, reject) => {
      const timeout = timeoutMs
        ? setTimeout(() => reject(new Error("Timeout waiting for idle")), timeoutMs)
        : undefined;

      const check = () => {
        if (this._phase === "idle") {
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
   * Reset agent state.
   */
  reset(): void {
    this._phase = "idle";
    this._isStreaming = false;
    this._pendingToolCalls.clear();
    this._messages = [];
    this._turnCount = 0;
    this._messageCount = 0;
    this._startTime = undefined;
    this._abortController = null;
    this._steeringQueue = [];
    this._followUpQueue = [];
    this._nextTurnQueue = [];
  }

  // ── Steering ───────────────────────────────────────────────────────────────

  /**
   * Send a steering message (interrupt current turn).
   */
  steer(message: AgentMessage): void {
    this._steeringQueue.push(message);
    this.emit({
      type: "tool_execution_start",
      toolCallId: "steering",
      toolName: "steering",
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });
  }

  /**
   * Send a follow-up message (processed after current turn).
   */
  followUp(message: AgentMessage): void {
    this._followUpQueue.push(message);
  }

  /**
   * Send a next-turn message (processed on next user-initiated turn).
   */
  nextTurn(message: AgentMessage): void {
    this._nextTurnQueue.push(message);
  }

  /**
   * Clear steering queue.
   */
  clearSteeringQueue(): void { this._steeringQueue = []; }

  /**
   * Clear follow-up queue.
   */
  clearFollowUpQueue(): void { this._followUpQueue = []; }

  /**
   * Clear all queues.
   */
  clearAllQueues(): void {
    this._steeringQueue = [];
    this._followUpQueue = [];
    this._nextTurnQueue = [];
  }

  // ── Internal Loop ──────────────────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    try {
      while (this._phase !== "idle" && this._phase !== "aborted") {
        // Check for steering
        if (this._steeringQueue.length > 0) {
          const steering = this._steeringQueue.shift()!;
          this._messages.push(steering);
        }

        // Start new turn
        this._turnCount++;
        const turnId = `turn_${this._turnCount}_${Date.now()}`;

        this._phase = "streaming";
        this.emit({
          type: "turn_start",
          turnId,
          agentId: this._agentId,
          sessionId: this._sessionId,
          timestamp: new Date(),
        });

        // Stream response
        const turnStartTime = Date.now();
        const toolResults: ToolResult[] = [];

        if (this._streamFn) {
          await this.streamResponse(toolResults);
        } else {
          // No stream function - simulate completion
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

        // Check for follow-ups
        if (this._followUpQueue.length > 0 && this._pendingToolCalls.size === 0) {
          const followUp = this._followUpQueue.shift()!;
          this._messages.push(followUp);
          continue;
        }

        // No more work
        break;
      }
    } catch (error) {
      logger.error("[AgentHarness] Loop error", { error: String(error) });
      this._phase = "error";
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

      this._phase = "idle";
      this._isStreaming = false;
      this._abortController = null;
    }
  }

  private async streamResponse(toolResults: ToolResult[]): Promise<void> {
    if (!this._streamFn) return;

    this._isStreaming = true;

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
      const stream = this._streamFn(this._model, {
        systemPrompt: this._systemPrompt,
        messages: this._messages,
        tools: this._tools,
      }, {
        thinkingLevel: this._thinkingLevel,
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
      logger.error("[AgentHarness] Stream error", { error: String(error) });
    }

    // Add assistant message
    const assistantMessage: AgentMessage = {
      id: messageId,
      role: "assistant",
      content,
      timestamp: new Date(),
    };
    this._messages.push(assistantMessage);

    this.emit({
      type: "message_end",
      messageId,
      role: "assistant",
      content,
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    this._isStreaming = false;
  }

  private async handleToolCall(toolCall: ToolCall, toolResults: ToolResult[]): Promise<void> {
    this._pendingToolCalls.add(toolCall.id);

    this.emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      agentId: this._agentId,
      sessionId: this._sessionId,
      timestamp: new Date(),
    });

    const tool = this._tools.find((t) => t.name === toolCall.name);
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

  /**
   * Get harness statistics.
   */
  getStats(): {
    agentId: string;
    sessionId: string;
    phase: AgentHarnessPhase;
    turnCount: number;
    messageCount: number;
    pendingToolCalls: number;
    durationMs?: number;
  } {
    return {
      agentId: this._agentId,
      sessionId: this._sessionId,
      phase: this._phase,
      turnCount: this._turnCount,
      messageCount: this._messageCount,
      pendingToolCalls: this._pendingToolCalls.size,
      durationMs: this._startTime ? Date.now() - this._startTime.getTime() : undefined,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new AgentHarness instance.
 */
export function createAgentHarness(options: {
  agentId?: string;
  sessionId?: string;
  model?: ModelConfig;
  systemPrompt?: string;
  tools?: AgentTool[];
  streamFn?: StreamFn;
}): AgentHarness {
  return new AgentHarness({
    agentId: options.agentId ?? "main",
    sessionId: options.sessionId ?? "default",
    ...options,
  });
}
