/**
 * Context Manager - Copilot CLI Style
 * 
 * Manages conversation context window with:
 * - Token tracking and estimation
 * - Auto-compaction when approaching limit
 * - Manual /compact command support
 * - Context visualization for /context command
 * 
 * Prevents context window overflow and maintains conversation continuity.
 */

import { type CoreMessage } from 'ai';
import { generateText } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import logger from '@/utils/logger';
import { isSelfHosted } from '@/config/mode.js';

/**
 * Context manager configuration
 */
export interface ContextManagerConfig {
  /** Maximum tokens allowed */
  maxTokens: number;
  
  /** Auto-compact threshold (percentage, default 0.8 = 80%) */
  autoCompactThreshold?: number;
  
  /** Number of recent messages to always keep */
  keepRecentCount?: number;
  
  /** Model to use for summarization */
  summaryModel?: string;
}

/**
 * Context statistics
 */
export interface ContextStats {
  totalMessages: number;
  systemMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolMessages: number;
  tokensUsed: number;
  tokensMax: number;
  percentageUsed: number;
  needsCompaction: boolean;
}

/**
 * Context Manager
 * 
 * Manages conversation context to prevent token overflow.
 */
export class ContextManager {
  private messages: CoreMessage[] = [];
  private config: ContextManagerConfig;
  private tokensUsed = 0;
  private compactionCount = 0;

  constructor(config: ContextManagerConfig) {
    this.config = {
      autoCompactThreshold: 0.8, // 80%
      keepRecentCount: 10,
      summaryModel: 'anthropic/claude-3-haiku', // Fast & cheap for summaries
      ...config,
    };
  }

  /**
   * Add a message to context
   */
  addMessage(message: CoreMessage): void {
    this.messages.push(message);
    this.tokensUsed = this.estimateTokens();

    // Check if auto-compaction is needed
    if (this.needsCompaction()) {
      logger.info('Auto-compaction triggered');
      this.compact().catch((error) => {
        logger.error('Auto-compaction failed:', error);
      });
    }
  }

  /**
   * Add tool result to context
   */
  addToolResult(toolCallId: string, result: any): void {
    this.messages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          result,
        },
      ],
    });
    this.tokensUsed = this.estimateTokens();
  }

  /**
   * Get all messages
   */
  getMessages(): CoreMessage[] {
    return this.messages;
  }

  /**
   * Get token count
   */
  getTokenCount(): number {
    return this.tokensUsed;
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(): boolean {
    if (isSelfHosted()) return false;
    const threshold = this.config.maxTokens * this.config.autoCompactThreshold!;
    return this.tokensUsed > threshold;
  }

  /**
   * Compact context by summarizing old messages
   */
  async compact(): Promise<void> {
    const systemMessages = this.messages.filter((m) => m.role === 'system');
    const recentMessages = this.messages.slice(-this.config.keepRecentCount!);
    const oldMessages = this.messages
      .slice(0, -this.config.keepRecentCount!)
      .filter((m) => m.role !== 'system');

    // Nothing to compact
    if (oldMessages.length === 0) {
      logger.warn('No messages to compact');
      return;
    }

    logger.info(`Compacting ${oldMessages.length} old messages...`);

    try {
      // Summarize old messages using a lightweight model
      const summary = await generateText({
        model: openrouter(this.config.summaryModel!),
        prompt: `Summarize this conversation history concisely, preserving key decisions and context:\n\n${this.formatMessagesForSummary(oldMessages)}`,
        maxTokens: 1000, // Keep summary short
      });

      // Replace old messages with summary
      this.messages = [
        ...systemMessages,
        {
          role: 'system',
          content: `Previous conversation summary (compaction ${++this.compactionCount}):\n\n${summary.text}`,
        },
        ...recentMessages,
      ];

      // Recalculate tokens
      this.tokensUsed = this.estimateTokens();

      logger.info(
        `Compaction completed. Tokens: ${oldMessages.length * 100} → ${this.tokensUsed}`
      );
    } catch (error) {
      logger.error('Compaction failed:', error);
      throw error;
    }
  }

  /**
   * Format messages for summarization
   */
  private formatMessagesForSummary(messages: CoreMessage[]): string {
    return messages
      .map((msg) => {
        if (msg.role === 'tool') {
          return `[Tool call result: ${JSON.stringify(msg.content).slice(0, 100)}...]`;
        }
        return `${msg.role}: ${JSON.stringify(msg.content).slice(0, 200)}`;
      })
      .join('\n');
  }

  /**
   * Clear all messages (new conversation)
   */
  clear(): void {
    const systemMessages = this.messages.filter((m) => m.role === 'system');
    this.messages = systemMessages;
    this.tokensUsed = this.estimateTokens();
    this.compactionCount = 0;
  }

  /**
   * Get context statistics
   */
  getStats(): ContextStats {
    const stats = {
      totalMessages: this.messages.length,
      systemMessages: this.messages.filter((m) => m.role === 'system').length,
      userMessages: this.messages.filter((m) => m.role === 'user').length,
      assistantMessages: this.messages.filter((m) => m.role === 'assistant').length,
      toolMessages: this.messages.filter((m) => m.role === 'tool').length,
      tokensUsed: this.tokensUsed,
      tokensMax: this.config.maxTokens,
      percentageUsed: (this.tokensUsed / this.config.maxTokens) * 100,
      needsCompaction: this.needsCompaction(),
    };

    return stats;
  }

  /**
   * Estimate tokens for all messages
   */
  private estimateTokens(): number {
    // Rough estimate: 1 token ≈ 4 characters
    const content = JSON.stringify(this.messages);
    return Math.ceil(content.length / 4);
  }

  /**
   * Visualize context usage (for /context command)
   */
  visualize(): string {
    const stats = this.getStats();
    const barLength = 50;
    const filled = Math.round((stats.percentageUsed / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    return `
Context Window Usage:
─────────────────────
Tokens: ${stats.tokensUsed} / ${stats.tokensMax} (${stats.percentageUsed.toFixed(1)}%)
[${bar}]

Messages:
  System: ${stats.systemMessages}
  User: ${stats.userMessages}
  Assistant: ${stats.assistantMessages}
  Tool: ${stats.toolMessages}
  Total: ${stats.totalMessages}

Compactions: ${this.compactionCount}
Status: ${stats.needsCompaction ? 'Warning:  Nearing limit' : '[OK] OK'}
`.trim();
  }

  /**
   * Export context state
   */
  export() {
    return {
      messages: this.messages,
      tokensUsed: this.tokensUsed,
      compactionCount: this.compactionCount,
      config: this.config,
    };
  }

  /**
   * Import context state
   */
  import(state: {
    messages: CoreMessage[];
    tokensUsed: number;
    compactionCount: number;
  }): void {
    this.messages = state.messages;
    this.tokensUsed = state.tokensUsed;
    this.compactionCount = state.compactionCount;
  }
}

/**
 * Create context manager with default config
 */
export function createContextManager(maxTokens = 128000): ContextManager {
  return new ContextManager({ maxTokens });
}
