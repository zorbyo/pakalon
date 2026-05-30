/**
 * Context Overflow Detection
 * 
 * Detects when context window is approaching limits.
 * Modeled after opencode's session/overflow.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Buffer reserved for compaction (tokens) */
export const COMPACTION_BUFFER = 20_000;

/** Default context limit if not specified */
export const DEFAULT_CONTEXT_LIMIT = 200_000;

/** Default output token limit */
export const DEFAULT_OUTPUT_MAX = 8_192;

/** Warning threshold (percentage) */
export const WARNING_THRESHOLD = 80;

/** Critical threshold (percentage) */
export const CRITICAL_THRESHOLD = 95;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OverflowConfig {
  /** Maximum context window size */
  contextLimit: number;
  /** Maximum output tokens */
  outputTokenMax?: number;
  /** Reserved tokens for compaction buffer */
  reserved?: number;
  /** Whether auto-compaction is enabled */
  autoCompaction?: boolean;
}

export type OverflowLevel = 'normal' | 'warning' | 'critical' | 'overflow';

export interface OverflowResult {
  /** Current overflow level */
  level: OverflowLevel;
  /** Whether overflow is detected */
  isOverflow: boolean;
  /** Usable token count */
  usable: number;
  /** Current token count */
  current: number;
  /** Remaining tokens */
  remaining: number;
  /** Overflow percentage (0-100+) */
  percentage: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate usable tokens given model limits and reserved buffer
 */
export function calculateUsableTokens(
  contextLimit: number,
  outputTokenMax: number = DEFAULT_OUTPUT_MAX,
  reserved: number = COMPACTION_BUFFER,
): number {
  if (contextLimit === 0) return 0;
  return Math.max(0, contextLimit - outputTokenMax - reserved);
}

/**
 * Get overflow level based on percentage
 */
export function getOverflowLevel(percentage: number): OverflowLevel {
  if (percentage >= 100) return 'overflow';
  if (percentage >= CRITICAL_THRESHOLD) return 'critical';
  if (percentage >= WARNING_THRESHOLD) return 'warning';
  return 'normal';
}

/**
 * Get detailed overflow status
 */
export function getOverflowStatus(
  tokenCount: number,
  config: OverflowConfig,
): OverflowResult {
  const { contextLimit, outputTokenMax = DEFAULT_OUTPUT_MAX, reserved = COMPACTION_BUFFER } = config;
  const usable = calculateUsableTokens(contextLimit, outputTokenMax, reserved);
  const percentage = usable > 0 ? Math.round((tokenCount / usable) * 100) : 0;
  const level = getOverflowLevel(percentage);

  return {
    level,
    isOverflow: percentage >= 100,
    usable,
    current: tokenCount,
    remaining: Math.max(0, usable - tokenCount),
    percentage,
  };
}

/**
 * Check if compaction should be triggered
 */
export function shouldCompact(
  tokenCount: number,
  config: OverflowConfig,
): boolean {
  if (config.autoCompaction === false) return false;
  const result = getOverflowStatus(tokenCount, config);
  return result.level === 'warning' || result.level === 'critical' || result.level === 'overflow';
}

/**
 * Get recommended action based on overflow level
 */
export function getRecommendedAction(level: OverflowLevel): string {
  switch (level) {
    case 'overflow':
      return 'Context overflow detected. Compaction required.';
    case 'critical':
      return 'Context approaching limit. Compaction recommended.';
    case 'warning':
      return 'Context usage high. Consider compaction.';
    case 'normal':
    default:
      return 'Context usage within normal limits.';
  }
}

export * as ContextOverflow from './contextOverflow.js';
