/**
 * Rate & Budget Limits System — Enforce token budgets and rate limits.
 *
 * Provides comprehensive rate limiting and budget enforcement:
 * - Per-tool rate limits (requests per minute)
 * - Per-session token budgets
 * - Global token budgets
 * - Sliding window rate limiting
 * - Budget tracking with reset windows
 *
 * Port from Claude Code's budget patterns.
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Tool name this applies to */
  toolName?: string;
  /** Whether this limit is enabled */
  enabled: boolean;
}

export interface BudgetConfig {
  /** Maximum tokens per window */
  maxTokens: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Session ID this applies to (null = global) */
  sessionId?: string;
  /** Whether this budget is enabled */
  enabled: boolean;
  /** Action when budget exceeded */
  onExceeded: "block" | "warn" | "downgrade";
}

export interface RateLimitState {
  /** Request timestamps in the current window */
  timestamps: number[];
  /** Current window start */
  windowStart: number;
  /** Current count */
  count: number;
}

export interface BudgetState {
  /** Token usage in the current window */
  tokens: number;
  /** Current window start */
  windowStart: number;
  /** Last update timestamp */
  lastUpdate: number;
  /** Whether budget was exceeded */
  exceeded: boolean;
  /** When budget was exceeded */
  exceededAt?: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current count */
  current: number;
  /** Maximum allowed */
  max: number;
  /** Remaining requests */
  remaining: number;
  /** When the window resets */
  resetAt: Date;
  /** Retry after milliseconds (if denied) */
  retryAfterMs?: number;
}

export interface BudgetResult {
  /** Whether the budget allows usage */
  allowed: boolean;
  /** Current token usage */
  current: number;
  /** Maximum allowed */
  max: number;
  /** Remaining tokens */
  remaining: number;
  /** When the window resets */
  resetAt: Date;
  /** Percentage used */
  percentUsed: number;
  /** Whether budget was exceeded */
  exceeded: boolean;
}

export interface RateLimitStats {
  /** Total requests processed */
  totalRequests: number;
  /** Total requests denied */
  deniedRequests: number;
  /** Requests by tool */
  byTool: Map<string, { allowed: number; denied: number }>;
  /** Current active limits */
  activeLimits: Array<{
    tool: string;
    current: number;
    max: number;
    remaining: number;
  }>;
}

export interface BudgetStats {
  /** Total tokens consumed */
  totalTokens: number;
  /** Token usage by session */
  bySession: Map<string, { tokens: number; budget: number }>;
  /** Current active budgets */
  activeBudgets: Array<{
    session: string;
    current: number;
    max: number;
    remaining: number;
    percentUsed: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter
// ─────────────────────────────────────────────────────────────────────────────

export class RateLimiter {
  private configs: Map<string, RateLimitConfig> = new Map();
  private states: Map<string, RateLimitState> = new Map();
  private stats: {
    totalRequests: number;
    deniedRequests: number;
    byTool: Map<string, { allowed: number; denied: number }>;
  } = {
    totalRequests: 0,
    deniedRequests: 0,
    byTool: new Map(),
  };

  /**
   * Configure rate limit for a tool.
   */
  configure(config: RateLimitConfig): void {
    const key = config.toolName ?? "*";
    this.configs.set(key, config);
    logger.debug("[RateLimiter] Configured", { tool: key, max: config.maxRequests });
  }

  /**
   * Check if a request is allowed.
   */
  check(toolName: string): RateLimitResult {
    this.stats.totalRequests++;

    const config = this.getConfigForTool(toolName);
    if (!config || !config.enabled) {
      return this.createAllowedResult(toolName, 0, Infinity);
    }

    const now = Date.now();
    const state = this.getState(toolName, now);

    // Clean old timestamps outside the window
    state.timestamps = state.timestamps.filter(
      (t) => now - t < config.windowMs
    );
    state.count = state.timestamps.length;

    const remaining = Math.max(0, config.maxRequests - state.count);
    const resetAt = new Date(state.windowStart + config.windowMs);

    if (state.count >= config.maxRequests) {
      this.stats.deniedRequests++;
      this.recordDenied(toolName);

      const oldestInWindow = state.timestamps[0] ?? now;
      const retryAfterMs = oldestInWindow + config.windowMs - now;

      return {
        allowed: false,
        current: state.count,
        max: config.maxRequests,
        remaining: 0,
        resetAt,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    this.recordAllowed(toolName);
    return {
      allowed: true,
      current: state.count,
      max: config.maxRequests,
      remaining,
      resetAt,
    };
  }

  /**
   * Record a request (after it's allowed).
   */
  record(toolName: string): void {
    const state = this.getState(toolName, Date.now());
    state.timestamps.push(Date.now());
    state.count = state.timestamps.length;
  }

  /**
   * Get stats for the rate limiter.
   */
  getStats(): RateLimitStats {
    const activeLimits: RateLimitStats["activeLimits"] = [];

    for (const [tool, state] of this.states) {
      const config = this.getConfigForTool(tool);
      if (config && config.enabled) {
        const now = Date.now();
        const activeTimestamps = state.timestamps.filter(
          (t) => now - t < config.windowMs
        );
        activeLimits.push({
          tool,
          current: activeTimestamps.length,
          max: config.maxRequests,
          remaining: Math.max(0, config.maxRequests - activeTimestamps.length),
        });
      }
    }

    return {
      totalRequests: this.stats.totalRequests,
      deniedRequests: this.stats.deniedRequests,
      byTool: new Map(this.stats.byTool),
      activeLimits,
    };
  }

  /**
   * Reset rate limiter state.
   */
  reset(): void {
    this.states.clear();
    this.stats = {
      totalRequests: 0,
      deniedRequests: 0,
      byTool: new Map(),
    };
    logger.debug("[RateLimiter] State reset");
  }

  private getConfigForTool(toolName: string): RateLimitConfig | undefined {
    // Exact match first
    if (this.configs.has(toolName)) {
      return this.configs.get(toolName);
    }

    // Wildcard match
    if (this.configs.has("*")) {
      return this.configs.get("*");
    }

    return undefined;
  }

  private getState(toolName: string, now: number): RateLimitState {
    let state = this.states.get(toolName);
    if (!state) {
      state = {
        timestamps: [],
        windowStart: now,
        count: 0,
      };
      this.states.set(toolName, state);
    }

    // Reset window if expired
    const config = this.getConfigForTool(toolName);
    if (config && now - state.windowStart >= config.windowMs) {
      state.timestamps = [];
      state.windowStart = now;
      state.count = 0;
    }

    return state;
  }

  private createAllowedResult(
    toolName: string,
    current: number,
    max: number
  ): RateLimitResult {
    return {
      allowed: true,
      current,
      max,
      remaining: max - current,
      resetAt: new Date(Date.now() + 60000),
    };
  }

  private recordAllowed(toolName: string): void {
    const entry = this.stats.byTool.get(toolName) ?? { allowed: 0, denied: 0 };
    entry.allowed++;
    this.stats.byTool.set(toolName, entry);
  }

  private recordDenied(toolName: string): void {
    const entry = this.stats.byTool.get(toolName) ?? { allowed: 0, denied: 0 };
    entry.denied++;
    this.stats.byTool.set(toolName, entry);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget Tracker
// ─────────────────────────────────────────────────────────────────────────────

export class BudgetTracker {
  private configs: Map<string, BudgetConfig> = new Map();
  private states: Map<string, BudgetState> = new Map();
  private stats: {
    totalTokens: number;
    bySession: Map<string, { tokens: number; budget: number }>;
  } = {
    totalTokens: 0,
    bySession: new Map(),
  };

  /**
   * Configure budget for a session or globally.
   */
  configure(config: BudgetConfig): void {
    const key = config.sessionId ?? "global";
    this.configs.set(key, config);
    logger.debug("[BudgetTracker] Configured", {
      session: key,
      maxTokens: config.maxTokens,
    });
  }

  /**
   * Check if token usage is within budget.
   */
  check(sessionId?: string, estimatedTokens?: number): BudgetResult {
    const key = sessionId ?? "global";
    const config = this.getConfigForSession(sessionId);
    
    if (!config || !config.enabled) {
      return this.createUnlimitedResult(estimatedTokens ?? 0);
    }

    const state = this.getState(sessionId, Date.now());

    // Reset window if expired
    const now = Date.now();
    if (now - state.windowStart >= config.windowMs) {
      state.tokens = 0;
      state.windowStart = now;
      state.exceeded = false;
      state.exceededAt = undefined;
    }

    const current = state.tokens + (estimatedTokens ?? 0);
    const remaining = Math.max(0, config.maxTokens - current);
    const percentUsed = Math.round((current / config.maxTokens) * 100);
    const resetAt = new Date(state.windowStart + config.windowMs);

    if (current >= config.maxTokens && !state.exceeded) {
      state.exceeded = true;
      state.exceededAt = now;
      logger.warn("[BudgetTracker] Budget exceeded", {
        session: key,
        tokens: current,
        max: config.maxTokens,
      });
    }

    return {
      allowed: current < config.maxTokens,
      current,
      max: config.maxTokens,
      remaining,
      resetAt,
      percentUsed,
      exceeded: state.exceeded,
    };
  }

  /**
   * Record token usage.
   */
  record(sessionId: string | undefined, tokens: number): void {
    const state = this.getState(sessionId, Date.now());
    state.tokens += tokens;
    state.lastUpdate = Date.now();
    this.stats.totalTokens += tokens;

    // Update session stats
    const key = sessionId ?? "global";
    const sessionStats = this.stats.bySession.get(key) ?? { tokens: 0, budget: 0 };
    sessionStats.tokens += tokens;
    const config = this.getConfigForSession(sessionId);
    if (config) {
      sessionStats.budget = config.maxTokens;
    }
    this.stats.bySession.set(key, sessionStats);
  }

  /**
   * Get stats for the budget tracker.
   */
  getStats(): BudgetStats {
    const activeBudgets: BudgetStats["activeBudgets"] = [];

    for (const [key, state] of this.states) {
      const config = this.getConfigForSession(key === "global" ? undefined : key);
      if (config && config.enabled) {
        const percentUsed = Math.round((state.tokens / config.maxTokens) * 100);
        activeBudgets.push({
          session: key,
          current: state.tokens,
          max: config.maxTokens,
          remaining: Math.max(0, config.maxTokens - state.tokens),
          percentUsed,
        });
      }
    }

    return {
      totalTokens: this.stats.totalTokens,
      bySession: new Map(this.stats.bySession),
      activeBudgets,
    };
  }

  /**
   * Reset budget tracker state.
   */
  reset(): void {
    this.states.clear();
    this.stats = {
      totalTokens: 0,
      bySession: new Map(),
    };
    logger.debug("[BudgetTracker] State reset");
  }

  private getConfigForSession(sessionId?: string): BudgetConfig | undefined {
    const key = sessionId ?? "global";
    return this.configs.get(key) ?? this.configs.get("global");
  }

  private getState(sessionId: string | undefined, now: number): BudgetState {
    const key = sessionId ?? "global";
    let state = this.states.get(key);
    if (!state) {
      state = {
        tokens: 0,
        windowStart: now,
        lastUpdate: now,
        exceeded: false,
      };
      this.states.set(key, state);
    }
    return state;
  }

  private createUnlimitedResult(tokens: number): BudgetResult {
    return {
      allowed: true,
      current: tokens,
      max: Infinity,
      remaining: Infinity,
      resetAt: new Date(Date.now() + 3600000),
      percentUsed: 0,
      exceeded: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instances
// ─────────────────────────────────────────────────────────────────────────────

let rateLimiterInstance: RateLimiter | null = null;
let budgetTrackerInstance: BudgetTracker | null = null;

/**
 * Get the singleton rate limiter.
 */
export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Get the singleton budget tracker.
 */
export function getBudgetTracker(): BudgetTracker {
  if (!budgetTrackerInstance) {
    budgetTrackerInstance = new BudgetTracker();
  }
  return budgetTrackerInstance;
}

/**
 * Reset all singletons (for testing).
 */
export function resetRateBudget(): void {
  rateLimiterInstance = null;
  budgetTrackerInstance = null;
}

/**
 * Initialize rate limiting and budget tracking with default configs.
 */
export function initializeRateBudget(): {
  rateLimiter: RateLimiter;
  budgetTracker: BudgetTracker;
} {
  const rateLimiter = getRateLimiter();
  const budgetTracker = getBudgetTracker();

  // Configure default rate limits
  rateLimiter.configure({
    toolName: "Bash",
    maxRequests: 30,
    windowMs: 60000, // 30 per minute
    enabled: true,
  });

  rateLimiter.configure({
    toolName: "Write",
    maxRequests: 20,
    windowMs: 60000, // 20 per minute
    enabled: true,
  });

  rateLimiter.configure({
    toolName: "Edit",
    maxRequests: 50,
    windowMs: 60000, // 50 per minute
    enabled: true,
  });

  // Configure default global budget
  budgetTracker.configure({
    maxTokens: 1000000, // 1M tokens per hour
    windowMs: 3600000, // 1 hour
    enabled: true,
    onExceeded: "warn",
  });

  logger.info("[RateBudget] Initialized with default configs");
  return { rateLimiter, budgetTracker };
}
