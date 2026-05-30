/**
 * Session Compactor
 *
 * Handles context compaction for sessions - summarizing old messages
 * to keep token usage within budget.
 */

/**
 * Compaction plan.
 */
export interface CompactionPlan {
  messagesToSummarize: unknown[];
  messagesToKeep: unknown[];
  estimatedTokensBefore: number;
}

/**
 * Handles session context compaction.
 */
export class SessionCompactor {
  private readonly tokenBudget: number;
  private readonly keepRecentCount: number;

  constructor(options?: { tokenBudget?: number; keepRecentCount?: number }) {
    this.tokenBudget = options?.tokenBudget ?? 100000;
    this.keepRecentCount = options?.keepRecentCount ?? 10;
  }

  /**
   * Check if compaction is needed.
   */
  shouldCompact(messages: unknown[], tokenBudget?: number): boolean {
    const budget = tokenBudget ?? this.tokenBudget;
    const estimatedTokens = this.estimateTokens(messages);
    return estimatedTokens > budget * 0.8; // Compact at 80% capacity
  }

  /**
   * Prepare a compaction plan.
   */
  prepareCompaction(messages: unknown[]): CompactionPlan {
    const estimatedTokens = this.estimateTokens(messages);

    // Keep system messages and recent messages
    const systemMessages: unknown[] = [];
    const recentMessages: unknown[] = [];
    const olderMessages: unknown[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as Record<string, unknown>;
      const role = msg.role ?? msg.type;

      if (role === 'system') {
        systemMessages.push(messages[i]!);
      } else if (i >= messages.length - this.keepRecentCount) {
        recentMessages.push(messages[i]!);
      } else {
        olderMessages.push(messages[i]!);
      }
    }

    return {
      messagesToSummarize: olderMessages,
      messagesToKeep: [...systemMessages, ...recentMessages],
      estimatedTokensBefore: estimatedTokens,
    };
  }

  /**
   * Apply compaction with a summary.
   */
  applyCompaction(
    messages: unknown[],
    summary: string,
    firstKeptMessageId: string,
  ): unknown[] {
    const plan = this.prepareCompaction(messages);

    // Create a summary message
    const summaryMessage = {
      role: 'system',
      type: 'compaction',
      content: `[Context Compacted]\n${summary}`,
      id: firstKeptMessageId,
    };

    return [summaryMessage, ...plan.messagesToKeep];
  }

  /**
   * Estimate token count for messages.
   */
  estimateTokens(messages: unknown[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += this.messageToText(msg).length;
    }
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(totalChars / 4);
  }

  /**
   * Extract text content from a message for token estimation.
   */
  private messageToText(msg: unknown): string {
    if (typeof msg === 'string') return msg;
    if (typeof msg !== 'object' || msg === null) return '';

    const obj = msg as Record<string, unknown>;

    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as Record<string, unknown>).text ?? '');
          }
          return '';
        })
        .join(' ');
    }

    return JSON.stringify(msg);
  }
}
