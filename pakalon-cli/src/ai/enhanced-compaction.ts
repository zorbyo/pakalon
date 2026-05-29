/**
 * Enhanced Compaction System — Advanced context management with multiple strategies.
 *
 * Provides comprehensive compaction:
 * - Micro-compaction: Remove redundant tool results
 * - API-driven compaction: Use LLM to summarize
 * - Session memory compaction: Preserve important context
 * - Time-based compaction: Compact based on age
 * - Token-based compaction: Compact based on token count
 * - Compaction settings: Configurable thresholds and strategies
 *
 * Port from Claude Code's compaction patterns.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CompactionStrategy =
  | "micro" // Remove redundant content
  | "api" // Use LLM to summarize
  | "session-memory" // Preserve important context
  | "time-based" // Compact based on age
  | "token-based"; // Compact based on token count

export interface CompactionSettings {
  /** Whether auto-compaction is enabled */
  enabled: boolean;
  /** Strategies to use (in order of preference) */
  strategies: CompactionStrategy[];
  /** Token threshold to trigger compaction */
  tokenThreshold: number;
  /** Target token count after compaction */
  targetTokens: number;
  /** Minimum messages to keep */
  minMessages: number;
  /** Maximum age (ms) for time-based compaction */
  maxAgeMs?: number;
  /** Whether to use LLM for summarization */
  useLlmSummarization: boolean;
  /** LLM model for summarization */
  summarizationModel?: string;
  /** Custom prompt for summarization */
  summarizationPrompt?: string;
}

export interface CompactionContext {
  /** Session ID */
  sessionId: string;
  /** Current messages */
  messages: CompactionMessage[];
  /** Current token count */
  tokenCount: number;
  /** Maximum tokens allowed */
  maxTokens: number;
  /** Timestamp */
  timestamp: Date;
}

export interface CompactionMessage {
  /** Message role */
  role: "user" | "assistant" | "system" | "tool";
  /** Message content */
  content: string;
  /** Message timestamp */
  timestamp: Date;
  /** Token count (estimated) */
  tokenCount: number;
  /** Whether this message is important */
  important?: boolean;
  /** Message metadata */
  metadata?: Record<string, unknown>;
}

export interface CompactionResult {
  /** Compacted messages */
  messages: CompactionMessage[];
  /** Tokens saved */
  tokensSaved: number;
  /** Strategy used */
  strategy: CompactionStrategy;
  /** Summary of what was compacted */
  summary: string;
  /** Whether compaction was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export interface MicroCompactionOptions {
  /** Maximum tool results to keep */
  maxToolResults?: number;
  /** Keep tool results newer than this (ms) */
  keepNewerThanMs?: number;
  /** Tool names to always keep */
  alwaysKeepTools?: string[];
}

export interface ApiCompactionOptions {
  /** LLM model to use */
  model?: string;
  /** Custom prompt */
  prompt?: string;
  /** Temperature for generation */
  temperature?: number;
  /** Max tokens for summary */
  maxSummaryTokens?: number;
}

export interface SessionMemoryCompactionOptions {
  /** Maximum tokens */
  maxTokens: number;
  /** Keep tail messages */
  keepTail?: number;
  /** Project directory for memory context */
  projectDir?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Settings
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: CompactionSettings = {
  enabled: true,
  strategies: ["micro", "token-based", "session-memory"],
  tokenThreshold: 100000,
  targetTokens: 60000,
  minMessages: 5,
  useLlmSummarization: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Compaction Engine
// ─────────────────────────────────────────────────────────────────────────────

export class EnhancedCompactionEngine {
  private settings: CompactionSettings;
  private compactHistory: Array<{
    timestamp: Date;
    strategy: CompactionStrategy;
    tokensSaved: number;
  }> = [];

  constructor(settings?: Partial<CompactionSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  /**
   * Update compaction settings.
   */
  updateSettings(settings: Partial<CompactionSettings>): void {
    this.settings = { ...this.settings, ...settings };
    logger.debug("[EnhancedCompaction] Settings updated", settings);
  }

  /**
   * Get current settings.
   */
  getSettings(): CompactionSettings {
    return { ...this.settings };
  }

  /**
   * Check if compaction is needed.
   */
  isCompactionNeeded(context: CompactionContext): boolean {
    if (!this.settings.enabled) return false;
    return context.tokenCount > this.settings.tokenThreshold;
  }

  /**
   * Perform compaction using the best available strategy.
   */
  async compact(context: CompactionContext): Promise<CompactionResult> {
    if (!this.settings.enabled) {
      return {
        messages: context.messages,
        tokensSaved: 0,
        strategy: "micro",
        summary: "Compaction disabled",
        success: true,
      };
    }

    // Try strategies in order
    for (const strategy of this.settings.strategies) {
      try {
        const result = await this.executeStrategy(strategy, context);
        if (result.success && result.tokensSaved > 0) {
          this.compactHistory.push({
            timestamp: new Date(),
            strategy,
            tokensSaved: result.tokensSaved,
          });
          return result;
        }
      } catch (error) {
        logger.error("[EnhancedCompaction] Strategy failed", {
          strategy,
          error: String(error),
        });
      }
    }

    // All strategies failed, return original messages
    return {
      messages: context.messages,
      tokensSaved: 0,
      strategy: "micro",
      summary: "No compaction strategy succeeded",
      success: false,
    };
  }

  /**
   * Execute a specific compaction strategy.
   */
  private async executeStrategy(
    strategy: CompactionStrategy,
    context: CompactionContext
  ): Promise<CompactionResult> {
    switch (strategy) {
      case "micro":
        return this.microCompact(context);
      case "api":
        return this.apiCompact(context);
      case "session-memory":
        return this.sessionMemoryCompact(context);
      case "time-based":
        return this.timeBasedCompact(context);
      case "token-based":
        return this.tokenBasedCompact(context);
      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }
  }

  /**
   * Micro-compaction: Remove redundant tool results.
   */
  private microCompact(context: CompactionContext): CompactionResult {
    const options: MicroCompactionOptions = {
      maxToolResults: 10,
      keepNewerThanMs: 5 * 60 * 1000, // 5 minutes
      alwaysKeepTools: ["bash", "edit", "write"],
    };

    const keepTail = this.settings.minMessages;
    const messages = [...context.messages];

    // Remove old tool results
    const compacted: CompactionMessage[] = [];
    let toolResultCount = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const isToolResult = msg.role === "tool";
      const isRecent = Date.now() - msg.timestamp.getTime() < (options.keepNewerThanMs ?? 0);
      const shouldKeep = !isToolResult || isRecent || toolResultCount < (options.maxToolResults ?? 0);

      if (shouldKeep) {
        compacted.unshift(msg);
        if (isToolResult) toolResultCount++;
      }
    }

    // Always keep the tail messages
    const tail = messages.slice(-keepTail);
    const unique = new Set(compacted.map((m) => m.content));
    const result = [...compacted.filter((m) => !unique.has(m.content) || tail.includes(m)), ...tail];

    // Deduplicate by content
    const seen = new Set<string>();
    const deduped = result.filter((m) => {
      const key = `${m.role}:${m.content.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const tokensSaved = context.tokenCount - this.estimateTokens(deduped);

    return {
      messages: deduped,
      tokensSaved: Math.max(0, tokensSaved),
      strategy: "micro",
      summary: `Removed ${messages.length - deduped.length} redundant messages`,
      success: true,
    };
  }

  /**
   * API-driven compaction: Use LLM to summarize.
   */
  private async apiCompact(context: CompactionContext): Promise<CompactionResult> {
    if (!this.settings.useLlmSummarization) {
      return {
        messages: context.messages,
        tokensSaved: 0,
        strategy: "api",
        summary: "LLM summarization disabled",
        success: false,
      };
    }

    // This would integrate with an LLM API
    // For now, return a placeholder
    logger.info("[EnhancedCompaction] API compaction not yet implemented");
    return {
      messages: context.messages,
      tokensSaved: 0,
      strategy: "api",
      summary: "API compaction not implemented",
      success: false,
    };
  }

  /**
   * Session memory compaction: Preserve important context.
   */
  private sessionMemoryCompact(context: CompactionContext): CompactionResult {
    const keepTail = this.settings.minMessages;
    const messages = [...context.messages];

    // Identify important messages
    const important = messages.filter((m) => this.isImportantMessage(m));
    const tail = messages.slice(-keepTail);
    const middle = messages.slice(keepTail, -keepTail);

    // Keep important messages and tail
    const keepSet = new Set([...important, ...tail].map((m) => m.content));
    const result = [...important, ...middle.filter((m) => keepSet.has(m.content)), ...tail];

    // Deduplicate
    const seen = new Set<string>();
    const deduped = result.filter((m) => {
      const key = `${m.role}:${m.content.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const tokensSaved = context.tokenCount - this.estimateTokens(deduped);

    return {
      messages: deduped,
      tokensSaved: Math.max(0, tokensSaved),
      strategy: "session-memory",
      summary: `Preserved ${important.length} important messages, removed ${messages.length - deduped.length}`,
      success: true,
    };
  }

  /**
   * Time-based compaction: Remove old messages.
   */
  private timeBasedCompact(context: CompactionContext): CompactionResult {
    const maxAge = this.settings.maxAgeMs ?? 30 * 60 * 1000; // 30 minutes default
    const keepTail = this.settings.minMessages;
    const messages = [...context.messages];
    const now = Date.now();

    const recent = messages.filter(
      (m) => now - m.timestamp.getTime() < maxAge
    );
    const tail = messages.slice(-keepTail);

    const keepSet = new Set([...recent, ...tail].map((m) => m.content));
    const result = messages.filter((m) => keepSet.has(m.content));

    // Deduplicate
    const seen = new Set<string>();
    const deduped = result.filter((m) => {
      const key = `${m.role}:${m.content.slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const tokensSaved = context.tokenCount - this.estimateTokens(deduped);

    return {
      messages: deduped,
      tokensSaved: Math.max(0, tokensSaved),
      strategy: "time-based",
      summary: `Removed messages older than ${maxAge / 1000}s`,
      success: true,
    };
  }

  /**
   * Token-based compact: Keep messages within token budget.
   */
  private tokenBasedCompact(context: CompactionContext): CompactionResult {
    const targetTokens = this.settings.targetTokens;
    const keepTail = this.settings.minMessages;
    const messages = [...context.messages];

    // Start from the end and work backwards
    const result: CompactionMessage[] = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const msgTokens = msg.tokenCount || this.estimateMessageTokens(msg);

      if (result.length < keepTail || currentTokens + msgTokens <= targetTokens) {
        result.unshift(msg);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    const tokensSaved = context.tokenCount - currentTokens;

    return {
      messages: result,
      tokensSaved: Math.max(0, tokensSaved),
      strategy: "token-based",
      summary: `Reduced from ${context.tokenCount} to ${currentTokens} tokens`,
      success: true,
    };
  }

  private isImportantMessage(msg: CompactionMessage): boolean {
    if (msg.important) return true;
    if (msg.role === "system") return true;
    if (msg.metadata?.important) return true;
    // Keep first and last user messages
    return false;
  }

  private estimateTokens(messages: CompactionMessage[]): number {
    return messages.reduce((sum, m) => sum + (m.tokenCount || this.estimateMessageTokens(m)), 0);
  }

  private estimateMessageTokens(msg: CompactionMessage): number {
    // Rough estimate: 4 characters per token
    return Math.ceil(msg.content.length / 4);
  }

  /**
   * Get compaction history.
   */
  getHistory(): Array<{
    timestamp: Date;
    strategy: CompactionStrategy;
    tokensSaved: number;
  }> {
    return [...this.compactHistory];
  }

  /**
   * Clear compaction history.
   */
  clearHistory(): void {
    this.compactHistory = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let engineInstance: EnhancedCompactionEngine | null = null;

/**
 * Get the singleton enhanced compaction engine.
 */
export function getEnhancedCompactionEngine(
  settings?: Partial<CompactionSettings>
): EnhancedCompactionEngine {
  if (!engineInstance) {
    engineInstance = new EnhancedCompactionEngine(settings);
  }
  return engineInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetEnhancedCompactionEngine(): void {
  engineInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if compaction is needed.
 */
export function isCompactionNeeded(
  tokenCount: number,
  maxTokens: number
): boolean {
  const engine = getEnhancedCompactionEngine();
  return engine.isCompactionNeeded({
    sessionId: "",
    messages: [],
    tokenCount,
    maxTokens,
    timestamp: new Date(),
  });
}

/**
 * Perform micro-compaction.
 */
export function microCompact(
  messages: CompactionMessage[],
  options?: MicroCompactionOptions
): CompactionMessage[] {
  const engine = getEnhancedCompactionEngine();
  const context: CompactionContext = {
    sessionId: "",
    messages,
    tokenCount: messages.reduce((sum, m) => sum + (m.tokenCount || 0), 0),
    maxTokens: Infinity,
    timestamp: new Date(),
  };

  // Use micro strategy directly
  const result = engine["microCompact"](context);
  return result.messages;
}
