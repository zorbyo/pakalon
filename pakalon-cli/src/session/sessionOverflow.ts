/**
 * Session Overflow Detection
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

export interface OverflowResult {
  /** Whether overflow is detected */
  isOverflow: boolean;
  /** Usable token count */
  usable: number;
  /** Current token count */
  current: number;
  /** Remaining tokens */
  remaining: number;
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
 * Check if current token count exceeds usable limit
 */
export function isOverflow(
  tokenCount: number,
  contextLimit: number,
  outputTokenMax: number = DEFAULT_OUTPUT_MAX,
  reserved: number = COMPACTION_BUFFER,
): boolean {
  if (contextLimit === 0) return false;
  const usable = calculateUsableTokens(contextLimit, outputTokenMax, reserved);
  return tokenCount >= usable;
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
  const isOverflow = tokenCount >= usable;

  return {
    isOverflow,
    usable,
    current: tokenCount,
    remaining: Math.max(0, usable - tokenCount),
  };
}

/**
 * Get overflow percentage (0-100)
 */
export function getOverflowPercentage(
  tokenCount: number,
  config: OverflowConfig,
): number {
  const { contextLimit, outputTokenMax = DEFAULT_OUTPUT_MAX, reserved = COMPACTION_BUFFER } = config;
  const usable = calculateUsableTokens(contextLimit, outputTokenMax, reserved);
  if (usable === 0) return 0;
  return Math.min(100, Math.round((tokenCount / usable) * 100));
}

export * as SessionOverflow from './sessionOverflow.js';
