/**
 * Reactive-Compact Strategy
 *
 * Automatically triggers compaction when the API returns a 413
 * (Prompt Too Long) or similar context overflow error. This is a
 * critical recovery mechanism for long-running agent sessions.
 *
 * Strategy:
 * 1. Detect prompt-too-long errors (413, context_length_exceeded)
 * 2. Calculate how much to compact
 * 3. Apply aggressive compaction
 * 4. Retry the original request
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ReactiveCompactOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Compaction aggressiveness (0-1, default: 0.5) */
  aggressiveness?: number;
  /** Preserve system prompt (default: true) */
  preserveSystemPrompt?: boolean;
  /** Preserve recent N messages (default: 5) */
  preserveRecent?: number;
  /** Callback to get current token count */
  getTokenCount?: () => number;
  /** Callback to get max token limit */
  getMaxTokens?: () => number;
}

export interface ReactiveCompactResult {
  /** Whether compaction was triggered */
  triggered: boolean;
  /** Number of retries attempted */
  retriesAttempted: number;
  /** Messages removed */
  messagesRemoved: number;
  /** Token savings achieved */
  tokenSavings: number;
  /** Whether the retry succeeded */
  retrySucceeded: boolean;
  /** Error message if failed */
  error?: string;
}

export interface CompactableMessage {
  role: string;
  content: string;
  timestamp?: Date;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an error is a prompt-too-long error that can be recovered
 * via reactive compaction.
 */
export function isPromptTooLongError(error: Error | { message?: string; status?: number; code?: string }): boolean {
  const message = error.message?.toLowerCase() || '';
  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code?.toLowerCase() || '';

  // HTTP 413 Payload Too Large
  if (status === 413) return true;

  // OpenAI/Anthropic context length errors
  if (message.includes('context_length_exceeded')) return true;
  if (message.includes('maximum context length')) return true;
  if (message.includes('prompt is too long')) return true;
  if (message.includes('token limit')) return true;
  if (message.includes('too many tokens')) return true;
  if (message.includes('context window')) return true;

  // Generic overflow indicators
  if (message.includes('overflow')) return true;
  if (message.includes('exceeds')) return true;

  // Error codes
  if (code.includes('context')) return true;

  return false;
}

/**
 * Extract token usage from error message if available.
 */
export function extractTokenUsage(error: Error): { used?: number; limit?: number } {
  const message = error.message || '';

  // Try to extract numbers from error message
  const tokenMatch = message.match(/(\d+)\s*tokens?\s*(?:used|exceeds|limit)/i);
  const limitMatch = message.match(/(?:limit|max|maximum)[:\s]*(\d+)/i);

  return {
    used: tokenMatch ? parseInt(tokenMatch[1]) : undefined,
    limit: limitMatch ? parseInt(limitMatch[1]) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compaction Logic
//  ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate how many messages to remove based on aggressiveness.
 */
function calculateRemovalCount(
  messages: CompactableMessage[],
  aggressiveness: number,
  preserveRecent: number
): number {
  const removableCount = messages.length - preserveRecent;
  const removalTarget = Math.ceil(removableCount * aggressiveness);
  return Math.min(removalTarget, removableCount);
}

/**
 * Calculate approximate token count for a message.
 */
function estimateMessageTokens(message: CompactableMessage): number {
  // Rough estimate: 1 token ~ 4 characters
  const contentLength = message.content?.length || 0;
  const metadataLength = message.metadata ? JSON.stringify(message.metadata).length : 0;
  return Math.ceil((contentLength + metadataLength) / 4);
}

/**
 * Apply reactive compaction to messages.
 * Removes oldest messages while preserving system prompts and recent context.
 */
export function applyReactiveCompact(
  messages: CompactableMessage[],
  options: ReactiveCompactOptions = {}
): {
  messages: CompactableMessage[];
  removedCount: number;
  tokenSavings: number;
} {
  const {
    aggressiveness = 0.5,
    preserveSystemPrompt = true,
    preserveRecent = 5,
  } = options;

  // Separate system messages from conversation
  const systemMessages = preserveSystemPrompt
    ? messages.filter(m => m.role === 'system')
    : [];
  const conversationMessages = messages.filter(m => m.role !== 'system');

  // Calculate removal target
  const removalCount = calculateRemovalCount(
    conversationMessages,
    aggressiveness,
    preserveRecent
  );

  if (removalCount <= 0) {
    return {
      messages,
      removedCount: 0,
      tokenSavings: 0,
    };
  }

  // Remove oldest messages (keep recent ones)
  const removedMessages = conversationMessages.slice(0, removalCount);
  const preservedMessages = conversationMessages.slice(removalCount);

  // Calculate token savings
  const tokenSavings = removedMessages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0
  );

  // Reconstruct messages array
  const result = [
    ...systemMessages,
    ...preservedMessages,
  ];

  return {
    messages: result,
    removedCount: removalCount,
    tokenSavings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt reactive compaction and retry.
 *
 * This function should be called when a prompt-too-long error is detected.
 * It will compact the context and provide information for retrying.
 */
export async function reactiveCompact<T>(
  messages: CompactableMessage[],
  retryFn: (compactedMessages: CompactableMessage[]) => Promise<T>,
  options: ReactiveCompactOptions = {}
): Promise<{ result?: T; compactResult: ReactiveCompactResult }> {
  const {
    maxRetries = 3,
    aggressiveness = 0.5,
    preserveRecent = 5,
  } = options;

  logger.debug('[ReactiveCompact] Starting reactive compaction', {
    messageCount: messages.length,
    maxRetries,
    aggressiveness,
  });

  let currentMessages = [...messages];
  let retriesAttempted = 0;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    retriesAttempted = attempt + 1;

    // Apply compaction with increasing aggressiveness
    const currentAggressiveness = Math.min(aggressiveness + (attempt * 0.15), 0.9);
    const compactResult = applyReactiveCompact(currentMessages, {
      aggressiveness: currentAggressiveness,
      preserveRecent,
    });

    logger.debug('[ReactiveCompact] Applied compaction', {
      attempt: attempt + 1,
      aggressiveness: currentAggressiveness,
      removedCount: compactResult.removedCount,
      tokenSavings: compactResult.tokenSavings,
      remainingMessages: compactResult.messages.length,
    });

    currentMessages = compactResult.messages;

    // Add a system message indicating compaction occurred
    currentMessages.push({
      role: 'system',
      content: `[ReactiveCompact] Context was compacted to fit within token limits. ${compactResult.removedCount} messages removed, ~${compactResult.tokenSavings} tokens saved.`,
      metadata: {
        type: 'reactive_compact',
        attempt: attempt + 1,
        removedCount: compactResult.removedCount,
        tokenSavings: compactResult.tokenSavings,
      },
    });

    // Try the retry function
    try {
      const result = await retryFn(currentMessages);
      logger.debug('[ReactiveCompact] Retry succeeded', { attempt: attempt + 1 });
      return {
        result,
        compactResult: {
          triggered: true,
          retriesAttempted,
          messagesRemoved: compactResult.removedCount,
          tokenSavings: compactResult.tokenSavings,
          retrySucceeded: true,
        },
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err.message;

      logger.warn('[ReactiveCompact] Retry failed', {
        attempt: attempt + 1,
        error: err.message,
      });

      // Check if it's still a prompt-too-long error
      if (!isPromptTooLongError(err)) {
        // Different error - don't retry
        break;
      }
    }
  }

  // All retries exhausted
  return {
    compactResult: {
      triggered: true,
      retriesAttempted,
      messagesRemoved: messages.length - currentMessages.length,
      tokenSavings: 0,
      retrySucceeded: false,
      error: lastError || 'Max retries exhausted',
    },
  };
}

export default reactiveCompact;