/**
 * Snip-Compact Strategy
 *
 * Removes repeated command patterns from conversation history to reduce
 * token count while preserving important context. This is useful for
 * long-running agent sessions where the same commands are executed
 * multiple times (e.g., git status, ls, cat).
 *
 * Strategy:
 * 1. Identify repeated tool call patterns (same tool + similar args)
 * 2. Group consecutive repetitions
 * 3. Replace groups with a summary "N times: tool_name(args)"
 * 4. Preserve first and last occurrence for context
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SnipCompactOptions {
  /** Minimum number of repetitions to trigger snipping (default: 3) */
  minRepetitions?: number;
  /** Maximum ratio of history to preserve (0-1, default: 0.7) */
  preserveRatio?: number;
  /** Tools to never snip (default: critical tools) */
  protectedTools?: string[];
  /** Maximum token savings target (0-1, default: 0.3) */
  targetSavings?: number;
}

export interface SnipGroup {
  toolName: string;
  argsPattern: string;
  count: number;
  firstIndex: number;
  lastIndex: number;
  indices: number[];
}

export interface SnipCompactResult {
  /** Original message count */
  originalCount: number;
  /** New message count after snipping */
  newCount: number;
  /** Number of messages removed */
  removedCount: number;
  /** Token savings estimate */
  tokenSavings: number;
  /** Snip groups that were compressed */
  snipGroups: SnipGroup[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<SnipCompactOptions> = {
  minRepetitions: 3,
  preserveRatio: 0.7,
  protectedTools: [
    'Write',
    'Edit',
    'Bash',
    'TodoWrite',
    'Task',
  ],
  targetSavings: 0.3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a normalized pattern from tool call arguments.
 * Simplifies args to detect similar patterns.
 */
function extractArgsPattern(args: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Normalize file paths and URLs
      if (value.includes('/') || value.includes('\\')) {
        normalized[key] = '<path>';
      } else if (value.startsWith('http')) {
        normalized[key] = '<url>';
      } else if (value.length > 50) {
        normalized[key] = '<long_string>';
      } else {
        normalized[key] = value;
      }
    } else if (typeof value === 'number') {
      normalized[key] = '<number>';
    } else if (typeof value === 'boolean') {
      normalized[key] = value;
    } else if (Array.isArray(value)) {
      normalized[key] = `<array[${value.length}]>`;
    } else if (typeof value === 'object' && value !== null) {
      normalized[key] = '<object>';
    }
  }

  return JSON.stringify(normalized);
}

/**
 * Detect repeated tool call patterns in message history.
 */
export function detectRepetitions(
  messages: Array<{ role: string; content?: string; metadata?: Record<string, unknown> }>,
  options: SnipCompactOptions = {}
): SnipGroup[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const groups: Map<string, SnipGroup> = new Map();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Only analyze tool use messages
    if (msg.role !== 'tool' && msg.role !== 'assistant') continue;

    // Check for tool call metadata
    const toolName = msg.metadata?.toolName as string;
    const toolArgs = msg.metadata?.toolArgs as Record<string, unknown>;

    if (!toolName || !toolArgs) continue;

    // Skip protected tools
    if (opts.protectedTools.includes(toolName)) continue;

    // Create pattern key
    const argsPattern = extractArgsPattern(toolArgs);
    const patternKey = `${toolName}:${argsPattern}`;

    if (groups.has(patternKey)) {
      const group = groups.get(patternKey)!;
      group.count++;
      group.lastIndex = i;
      group.indices.push(i);
    } else {
      groups.set(patternKey, {
        toolName,
        argsPattern,
        count: 1,
        firstIndex: i,
        lastIndex: i,
        indices: [i],
      });
    }
  }

  // Filter to only groups with enough repetitions
  return Array.from(groups.values()).filter(g => g.count >= opts.minRepetitions);
}

// ─────────────────────────────────────────────────────────────────────────────
// Snip Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply snip-compact to messages, replacing repeated patterns with summaries.
 */
export function applySnipCompact(
  messages: Array<{ role: string; content?: string; metadata?: Record<string, unknown> }>,
  options: SnipCompactOptions = {}
): {
  messages: typeof messages;
  result: SnipCompactResult;
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalCount = messages.length;

  // Detect repetitions
  const snipGroups = detectRepetitions(messages, opts);

  if (snipGroups.length === 0) {
    return {
      messages,
      result: {
        originalCount,
        newCount: originalCount,
        removedCount: 0,
        tokenSavings: 0,
        snipGroups: [],
      },
    };
  }

  // Calculate which messages to remove
  const messagesToRemove = new Set<number>();

  for (const group of snipGroups) {
    // Keep first occurrence, remove middle occurrences, keep last
    if (group.count > 2) {
      // Remove indices between first and last (exclusive)
      for (let i = 1; i < group.indices.length - 1; i++) {
        messagesToRemove.add(group.indices[i]);
      }
    }
  }

  // Build new messages array
  const newMessages = messages.filter((_, index) => !messagesToRemove.has(index));

  // Add summary messages for each snipped group
  const summaryMessages: Array<{ role: string; content: string; metadata: Record<string, unknown> }> = [];

  for (const group of snipGroups) {
    const removedCount = group.count - 2; // Keep first and last
    if (removedCount > 0) {
      summaryMessages.push({
        role: 'system',
        content: `[Snip] ${group.toolName}(${group.argsPattern}) was called ${group.count} times (${removedCount} repetitions removed)`,
        metadata: {
          type: 'snip_summary',
          toolName: group.toolName,
          originalCount: group.count,
          removedCount,
        },
      });
    }
  }

  // Insert summaries after first occurrence of each group
  const result = [...newMessages];
  let insertOffset = 0;

  for (const group of snipGroups) {
    if (group.count > 2) {
      const insertIndex = group.firstIndex + 1 + insertOffset;
      if (insertIndex <= result.length) {
        const summary = summaryMessages.find(
          s => s.metadata.toolName === group.toolName
        );
        if (summary) {
          result.splice(insertIndex, 0, summary);
          insertOffset++;
        }
      }
    }
  }

  // Calculate token savings (rough estimate: 1 token ~ 4 chars)
  const removedChars = messagesToRemove.size * 100; // Assume ~100 chars per message
  const tokenSavings = Math.floor(removedChars / 4);

  return {
    messages: result,
    result: {
      originalCount,
      newCount: result.length,
      removedCount: messagesToRemove.size,
      tokenSavings,
      snipGroups,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main snip-compact function.
 * Analyzes message history and removes repeated command patterns.
 */
export function snipCompact(
  messages: Array<{ role: string; content?: string; metadata?: Record<string, unknown> }>,
  options: SnipCompactOptions = {}
): {
  messages: typeof messages;
  result: SnipCompactResult;
} {
  logger.debug('[SnipCompact] Starting snip-compact analysis', {
    messageCount: messages.length,
    options,
  });

  const result = applySnipCompact(messages, options);

  logger.debug('[SnipCompact] Snip-compact complete', {
    originalCount: result.result.originalCount,
    newCount: result.result.newCount,
    removedCount: result.result.removedCount,
    tokenSavings: result.result.tokenSavings,
    groupsFound: result.result.snipGroups.length,
  });

  return result;
}

export default snipCompact;