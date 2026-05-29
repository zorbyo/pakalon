/**
 * Speculation Engine — Pre-computation for Zero-Latency UX
 *
 * Speculates the next AI response while the user is typing, using cached context.
 * When the user sends their message, the speculated response can be used
 * immediately if the speculation matches.
 *
 * This is a UX optimization, not a functional requirement. It reduces perceived
 * latency by starting generation before the user finishes typing.
 *
 * Features:
 *   - User intent speculation: pre-computes likely next response
 *   - Pipelined suggestions: speculates the next prompt from user intent
 *   - Speculation boundary detection: detects when speculation completed
 *   - Abort support: cancels speculation when user intent changes
 */

import type { Message } from "../tools/tool-types.js";

// ============================================================================
// Types
// ============================================================================

export interface CompletionBoundary {
  type: "complete" | "bash" | "edit" | "denied_tool";
  completedAt: number;
  outputTokens?: number;
  command?: string;
  toolName?: string;
  filePath?: string;
  detail?: string;
}

export interface PipelinedSuggestion {
  text: string;
  promptId: "user_intent" | "stated_intent";
  generationRequestId: string | null;
}

export interface SpeculationState {
  status: "idle" | "active";
  id?: string;
  abort?: () => void;
  startTime?: number;
  messages?: Message[];
  writtenPaths?: Set<string>;
  boundary?: CompletionBoundary | null;
  suggestionLength?: number;
  toolUseCount?: number;
  isPipelined?: boolean;
  pipelinedSuggestion?: PipelinedSuggestion | null;
  /** Set when speculation was aborted, not finished naturally. */
  abortReason?: "timeout" | "aborted" | "user_input";
}

export interface SpeculationConfig {
  /** Max speculation duration before abort (ms). */
  maxSpeculationDuration: number;

  /** Minimum idle time before starting speculation (ms). */
  idleWaitMs: number;

  /** Max messages to use for speculation context. */
  maxContextMessages: number;

  /** Whether pipelined suggestions are enabled. */
  enablePipelinedSuggestions: boolean;

  /** Max tool uses in a speculated response. */
  maxSpeculatedToolUses: number;
}

export interface SpeculationResult {
  messages: Message[];
  boundary: CompletionBoundary | null;
  timeSavedMs: number;
  wasUsed: boolean;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: SpeculationConfig = {
  maxSpeculationDuration: 10_000, // 10 seconds
  idleWaitMs: 2_000, // Wait 2s of idle before speculating
  maxContextMessages: 20,
  enablePipelinedSuggestions: false,
  maxSpeculatedToolUses: 3,
};

// ============================================================================
// SpeculationEngine
// ============================================================================

export class SpeculationEngine {
  private config: SpeculationConfig;
  private state: SpeculationState;
  private pendingMessages: Message[];

  constructor(config?: Partial<SpeculationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = { status: "idle" };
    this.pendingMessages = [];
  }

  /** Update configuration. */
  updateConfig(config: Partial<SpeculationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Get current config. */
  getConfig(): SpeculationConfig {
    return { ...this.config };
  }

  /** Get current state. */
  getState(): SpeculationState {
    return { ...this.state };
  }

  /**
   * Start speculation when user is idle.
   * Returns a speculation ID if started, null if not.
   */
  startSpeculation(context: {
    recentMessages: Message[];
    userInput: string;
  }): string | null {
    // Don't speculate if already active
    if (this.state.status === "active") return null;

    // Don't speculate if pipelined suggestions disabled and no context
    if (!this.config.enablePipelinedSuggestions && context.recentMessages.length === 0) {
      return null;
    }

    // Truncate context messages
    const messages = context.recentMessages.slice(-this.config.maxContextMessages);

    // Create abort controller
    const timeoutId = setTimeout(() => {
      this.abortSpeculation("timeout");
    }, this.config.maxSpeculationDuration);

    const speculationId = `spec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.state = {
      status: "active",
      id: speculationId,
      abort: () => {
        clearTimeout(timeoutId);
        this.abortSpeculation("aborted");
      },
      startTime: Date.now(),
      messages,
      writtenPaths: new Set(),
      boundary: null,
      suggestionLength: context.userInput.length,
      toolUseCount: 0,
      isPipelined: false,
      pipelinedSuggestion: null,
    };

    return speculationId;
  }

  /**
   * Register a speculative completion boundary.
   * Called by the speculation executor when a tool completes.
   */
  registerBoundary(boundary: CompletionBoundary): void {
    if (this.state.status !== "active") return;
    this.state.boundary = boundary;
    this.state.toolUseCount = (this.state.toolUseCount ?? 0) + 1;

    // Check if we've reached max speculated tool uses
    if (this.state.toolUseCount >= this.config.maxSpeculatedToolUses) {
      this.finishSpeculation();
    }
  }

  /**
   * Register a pipelined suggestion.
   */
  setPipelinedSuggestion(suggestion: PipelinedSuggestion): void {
    if (this.state.status !== "active") return;
    this.state.pipelinedSuggestion = suggestion;
    this.state.isPipelined = true;
  }

  /**
   * Abort speculation.
   * Preserves diagnostic data (boundary, messages) but sets status to idle
   * so tryMatchSpeculation can still inspect what was speculated.
   */
  abortSpeculation(reason: "timeout" | "aborted" | "user_input"): void {
    if (this.state.status !== "active") return;
    this.state = {
      status: "idle",
      abortReason: reason,
      startTime: this.state.startTime,
      messages: this.state.messages,
      boundary: this.state.boundary,
      suggestionLength: this.state.suggestionLength,
      toolUseCount: this.state.toolUseCount ?? 0,
      isPipelined: this.state.isPipelined,
      pipelinedSuggestion: this.state.pipelinedSuggestion,
    };
  }

  /**
   * Finish speculation normally.
   * Preserves speculation data (startTime, messages, boundary) so
   * tryMatchSpeculation can evaluate whether the speculation matches.
   */
  finishSpeculation(): void {
    if (this.state.status !== "active") return;
    this.state = {
      status: "idle",
      startTime: this.state.startTime,
      messages: this.state.messages,
      boundary: this.state.boundary,
      suggestionLength: this.state.suggestionLength,
      toolUseCount: this.state.toolUseCount ?? 0,
      isPipelined: this.state.isPipelined,
      pipelinedSuggestion: this.state.pipelinedSuggestion,
    };
  }

  /**
   * Check if the speculated response can be used for the actual input.
   * Returns the speculated state if match is close enough, null otherwise.
   */
  tryMatchSpeculation(actualInput: string): SpeculationResult | null {
    if (this.state.status !== "idle" || !this.state.startTime) return null;

    const timeSavedMs = Date.now() - this.state.startTime;

    // Basic match: we use the speculation if it completed
    // In production, more sophisticated matching would be used
    if (this.state.boundary) {
      return {
        messages: this.state.messages ?? [],
        boundary: this.state.boundary,
        timeSavedMs,
        wasUsed: true,
      };
    }

    return null;
  }

  /**
   * Record a user input event (triggers abort of active speculation).
   */
  onUserInput(input: string): void {
    if (this.state.status === "active") {
      this.abortSpeculation("user_input");
    }
    this.pendingMessages.push({ role: "user", content: input } as Message);
  }

  /**
   * Clear pending messages.
   */
  clearPendingMessages(): void {
    this.pendingMessages = [];
  }

  /**
   * Get pending messages.
   */
  getPendingMessages(): Message[] {
    return [...this.pendingMessages];
  }

  /**
   * Reset the engine completely.
   */
  reset(): void {
    this.state = { status: "idle" };
    this.pendingMessages = [];
  }

  /**
   * Check if speculation is possible given current context size.
   */
  canSpeculate(contextMessageCount: number): boolean {
    // Speculation is only useful with sufficient context
    if (contextMessageCount < 3) return false;

    // Don't speculate if there are already too many messages
    if (contextMessageCount > this.config.maxContextMessages * 2) return false;

    return true;
  }
}
