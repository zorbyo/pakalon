/**
 * Thinking Mode
 *
 * Full thinking/reasoning integration for models that support it.
 * Supports:
 * - Thinking/reasoning mode activation
 * - Reasoning trace capture
 * - Thinking budget management
 * - Mode switching (Shift+Tab)
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThinkingConfig {
  /** Whether thinking mode is enabled */
  enabled: boolean;
  /** Thinking budget (max tokens for thinking) */
  budget: number;
  /** Thinking model (if different from main model) */
  model?: string;
  /** Show thinking traces in output */
  showTraces: boolean;
}

export interface ThinkingTrace {
  /** Trace ID */
  id: string;
  /** Thinking content */
  content: string;
  /** Token usage */
  tokens: number;
  /** Duration (ms) */
  duration: number;
  /** Timestamp */
  timestamp: Date;
}

export interface ThinkingState {
  /** Current mode */
  mode: 'normal' | 'thinking';
  /** Thinking traces */
  traces: ThinkingTrace[];
  /** Total thinking tokens used */
  totalTokens: number;
  /** Budget remaining */
  budgetRemaining: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: ThinkingConfig = {
  enabled: true,
  budget: 10_000,
  showTraces: false,
};

let state: ThinkingState = {
  mode: 'normal',
  traces: [],
  totalTokens: 0,
  budgetRemaining: 10_000,
};

// ---------------------------------------------------------------------------
// Mode Management
// ---------------------------------------------------------------------------

/**
 * Toggle thinking mode
 */
export function toggleThinkingMode(): ThinkingState['mode'] {
  if (state.mode === 'normal') {
    state.mode = 'thinking';
    logger.info('[thinking] Enabled thinking mode');
  } else {
    state.mode = 'normal';
    logger.info('[thinking] Disabled thinking mode');
  }
  return state.mode;
}

/**
 * Enable thinking mode
 */
export function enableThinkingMode(): void {
  state.mode = 'thinking';
  logger.info('[thinking] Enabled thinking mode');
}

/**
 * Disable thinking mode
 */
export function disableThinkingMode(): void {
  state.mode = 'normal';
  logger.info('[thinking] Disabled thinking mode');
}

/**
 * Check if thinking mode is active
 */
export function isThinkingMode(): boolean {
  return state.mode === 'thinking' && config.enabled;
}

/**
 * Get current mode
 */
export function getThinkingMode(): ThinkingState['mode'] {
  return state.mode;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Update thinking config
 */
export function updateThinkingConfig(newConfig: Partial<ThinkingConfig>): void {
  config = { ...config, ...newConfig };
  state.budgetRemaining = config.budget - state.totalTokens;
  logger.info('[thinking] Configuration updated');
}

/**
 * Get thinking config
 */
export function getThinkingConfig(): ThinkingConfig {
  return { ...config };
}

// ---------------------------------------------------------------------------
// Trace Management
// ---------------------------------------------------------------------------

/**
 * Record a thinking trace
 */
export function recordThinkingTrace(
  content: string,
  tokens: number,
  duration: number,
): ThinkingTrace {
  const trace: ThinkingTrace = {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    tokens,
    duration,
    timestamp: new Date(),
  };

  state.traces.push(trace);
  state.totalTokens += tokens;
  state.budgetRemaining = config.budget - state.totalTokens;

  logger.debug(`[thinking] Recorded trace: ${tokens} tokens, ${duration}ms`);
  return trace;
}

/**
 * Get all traces
 */
export function getThinkingTraces(): ThinkingTrace[] {
  return [...state.traces];
}

/**
 * Get recent traces
 */
export function getRecentTraces(count: number): ThinkingTrace[] {
  return state.traces.slice(-count);
}

/**
 * Clear traces
 */
export function clearTraces(): void {
  state.traces = [];
  state.totalTokens = 0;
  state.budgetRemaining = config.budget;
  logger.info('[thinking] Cleared traces');
}

// ---------------------------------------------------------------------------
// Budget Management
// ---------------------------------------------------------------------------

/**
 * Check if thinking budget is available
 */
export function hasThinkingBudget(tokens: number): boolean {
  return state.budgetRemaining >= tokens;
}

/**
 * Get budget status
 */
export function getBudgetStatus(): {
  total: number;
  used: number;
  remaining: number;
  percentage: number;
} {
  return {
    total: config.budget,
    used: state.totalTokens,
    remaining: state.budgetRemaining,
    percentage: Math.round((state.totalTokens / config.budget) * 100),
  };
}

/**
 * Reset budget
 */
export function resetBudget(): void {
  state.totalTokens = 0;
  state.budgetRemaining = config.budget;
  logger.info('[thinking] Reset budget');
}

// ---------------------------------------------------------------------------
// Prompt Generation
// ---------------------------------------------------------------------------

/**
 * Generate thinking prompt prefix
 */
export function getThinkingPromptPrefix(): string {
  if (!isThinkingMode()) {
    return '';
  }

  return `<thinking>
Let me think through this step by step.
</thinking>

`;
}

/**
 * Generate thinking system prompt addition
 */
export function getThinkingSystemPrompt(): string {
  if (!isThinkingMode()) {
    return '';
  }

  return `
When in thinking mode:
1. Think through problems step by step
2. Show your reasoning process
3. Consider multiple approaches
4. Evaluate trade-offs
5. Provide clear conclusions

Use <thinking> tags to show your reasoning process.
`;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get thinking state
 */
export function getThinkingState(): ThinkingState {
  return { ...state };
}

/**
 * Reset thinking state
 */
export function resetThinkingState(): void {
  state = {
    mode: 'normal',
    traces: [],
    totalTokens: 0,
    budgetRemaining: config.budget,
  };
  logger.info('[thinking] Reset state');
}
