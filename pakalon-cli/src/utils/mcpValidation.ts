/**
 * MCP Content Validation and Truncation Logic
 *
 * Validates MCP tool outputs against size limits and applies
 * appropriate truncation strategies.
 */

import {
  DEFAULT_MAX_OUTPUT_SIZE,
  DEFAULT_TRUNCATION_THRESHOLD,
  estimateTokens,
  getContentSizeEstimate,
  type MCPToolResult,
} from './mcpOutputStorage.js';

export interface ValidationResult {
  valid: boolean;
  estimatedTokens: number;
  contentSize: number;
  needsTruncation: boolean;
  truncationRecommendation?: string;
  warnings: string[];
}

export interface TruncationOptions {
  maxOutputSize?: number;
  maxTokens?: number;
  preserveStructure?: boolean;
  includePlaceholder?: boolean;
}

const TOKEN_OVERHEAD_PER_MESSAGE = 50;
const CONTEXT_BUFFER_TOKENS = 500;

/**
 * Validate MCP tool result against size and token limits
 */
export function validateMcpResult(
  result: unknown,
  options: {
    maxOutputSize?: number;
    maxContextTokens?: number;
    currentContextTokens?: number;
  } = {}
): ValidationResult {
  const { maxOutputSize = DEFAULT_MAX_OUTPUT_SIZE, maxContextTokens, currentContextTokens = 0 } = options;

  const contentSize = getContentSizeEstimate(result);
  const estimatedTokens = estimateTokens(JSON.stringify(result));
  const warnings: string[] = [];

  // Check size limits
  if (contentSize > DEFAULT_MAX_OUTPUT_SIZE) {
    warnings.push(`Output exceeds maximum size (${contentSize} > ${DEFAULT_MAX_OUTPUT_SIZE})`);
  }

  // Check token limits if context tracking is enabled
  if (maxContextTokens) {
    const availableTokens = maxContextTokens - currentContextTokens - CONTEXT_BUFFER_TOKENS;
    if (estimatedTokens > availableTokens) {
      warnings.push(
        `Output tokens (${estimatedTokens}) would exceed available context (${availableTokens} available)`
      );
    }
  }

  // Determine truncation recommendation
  let truncationRecommendation: string | undefined;
  if (contentSize > DEFAULT_TRUNCATION_THRESHOLD) {
    const recommendedSize = Math.floor(DEFAULT_TRUNCATION_THRESHOLD * 0.8);
    truncationRecommendation = `Truncate to ~${recommendedSize} chars to maintain comfortable margin`;
  }

  return {
    valid: warnings.length === 0,
    estimatedTokens,
    contentSize,
    needsTruncation: contentSize > DEFAULT_TRUNCATION_THRESHOLD,
    truncationRecommendation,
    warnings,
  };
}

/**
 * Apply intelligent truncation to content
 */
export function applyTruncation(
  content: string,
  options: TruncationOptions = {}
): { truncated: string; removedChars: number; removedTokens: number } {
  const { maxOutputSize = DEFAULT_MAX_OUTPUT_SIZE, preserveStructure = true, includePlaceholder = true } = options;

  if (content.length <= maxOutputSize) {
    return { truncated: content, removedChars: 0, removedTokens: 0 };
  }

  const removedChars = content.length - maxOutputSize;
  const removedTokens = Math.ceil(removedChars / 4);

  let truncated = content.slice(0, maxOutputSize);

  if (preserveStructure) {
    // Try to truncate at a clean break point (newline or sentence)
    const lastNewline = truncated.lastIndexOf('\n');
    const lastPeriod = truncated.lastIndexOf('. ');

    const breakPoint = lastNewline > maxOutputSize * 0.8
      ? lastNewline
      : lastPeriod > maxOutputSize * 0.8
        ? lastPeriod + 2
        : maxOutputSize;

    truncated = content.slice(0, breakPoint);
  }

  if (includePlaceholder) {
    const placeholder = `\n\n[... output truncated, ${removedChars.toLocaleString()} characters removed ...]`;
    truncated += placeholder;
  }

  return {
    truncated,
    removedChars,
    removedTokens,
  };
}

/**
 * Check if truncation is needed based on context budget
 */
export function needsContextTruncation(
  currentTokens: number,
  maxTokens: number,
  resultTokens: number,
  bufferTokens = CONTEXT_BUFFER_TOKENS
): boolean {
  return currentTokens + resultTokens + bufferTokens > maxTokens;
}

/**
 * Calculate safe output size based on context budget
 */
export function calculateSafeOutputSize(
  currentTokens: number,
  maxTokens: number,
  overheadTokens = TOKEN_OVERHEAD_PER_MESSAGE
): number {
  const availableTokens = maxTokens - currentTokens - overheadTokens - CONTEXT_BUFFER_TOKENS;
  return Math.floor(availableTokens * 4); // Convert back to chars (4 chars per token)
}

/**
 * Format validation warnings for display
 */
export function formatValidationWarnings(result: ValidationResult): string {
  if (result.warnings.length === 0) {
    return '';
  }

  const lines = result.warnings.map(w => `Warning: ${w}`);
  if (result.truncationRecommendation) {
    lines.push(`[Idea] ${result.truncationRecommendation}`);
  }

  return lines.join('\n');
}

/**
 * Get a summary of the result for logging
 */
export function getResultSummary(result: unknown): {
  type: string;
  size: number;
  tokens: number;
  preview: string;
} {
  const type = Array.isArray(result) ? 'array' : typeof result;
  const size = getContentSizeEstimate(result);
  const tokens = estimateTokens(JSON.stringify(result));
  const preview = size > 100
    ? JSON.stringify(result).slice(0, 100) + '...'
    : JSON.stringify(result);

  return { type, size, tokens, preview };
}

/**
 * Check if result is too large for inline display
 */
export function isResultTooLargeForInline(result: unknown, maxInlineSize = 2000): boolean {
  return getContentSizeEstimate(result) > maxInlineSize;
}

/**
 * Create a compressed summary of a large result
 */
export function createResultSummary(result: unknown, maxLength = 500): string {
  const summary = getResultSummary(result);

  const parts = [
    `[Type: ${summary.type}]`,
    `[Size: ${summary.size.toLocaleString()} chars]`,
    `[Est. tokens: ${summary.tokens.toLocaleString()}]`,
  ];

  if (summary.size > maxLength) {
    parts.push(`[Preview: ${summary.preview.slice(0, maxLength)}...]`);
  } else {
    parts.push(`[Preview: ${summary.preview}]`);
  }

  return parts.join(' ');
}

export {
  DEFAULT_MAX_OUTPUT_SIZE,
  DEFAULT_TRUNCATION_THRESHOLD,
  estimateTokens,
  getContentSizeEstimate,
  type MCPToolResult,
} from './mcpOutputStorage.js';