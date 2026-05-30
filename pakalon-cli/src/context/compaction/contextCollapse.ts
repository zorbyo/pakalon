/**
 * Context Collapse Strategy
 *
 * Progressive context collapse with commit-log style staging.
 * When context becomes too large, this strategy progressively collapses
 * older messages into summaries while maintaining a "commit log" of
 * what was collapsed.
 *
 * Strategy:
 * 1. Divide messages into stages (recent, middle, old)
 * 2. Collapse old stage into a single summary
 * 3. Collapse middle stage into compressed form
 * 4. Keep recent stage intact
 * 5. Maintain a "commit log" of what was collapsed
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextCollapseOptions {
  /** Number of recent messages to preserve intact (default: 10) */
  preserveRecent?: number;
  /** Number of middle messages to keep compressed (default: 20) */
  keepMiddle?: number;
  /** Maximum token budget for collapsed context (default: 50000) */
  maxTokenBudget?: number;
  /** Whether to include commit log (default: true) */
  includeCommitLog?: boolean;
  /** Callback for LLM summarization */
  summarize?: (messages: CollapsibleMessage[]) => Promise<string>;
}

export interface CollapsibleMessage {
  role: string;
  content: string;
  timestamp?: Date;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface CollapseStage {
  name: 'recent' | 'middle' | 'old';
  messages: CollapsibleMessage[];
  startIndex: number;
  endIndex: number;
}

export interface CommitLogEntry {
  stage: string;
  messageCount: number;
  tokenEstimate: number;
  summary: string;
  timestamp: Date;
}

export interface ContextCollapseResult {
  /** Collapsed messages */
  messages: CollapsibleMessage[];
  /** Commit log of what was collapsed */
  commitLog: CommitLogEntry[];
  /** Token savings achieved */
  tokenSavings: number;
  /** Whether collapse was applied */
  collapsed: boolean;
  /** Original message count */
  originalCount: number;
  /** New message count */
  newCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate token count for a message.
 */
function estimateTokens(message: CollapsibleMessage): number {
  const contentLength = message.content?.length || 0;
  return Math.ceil(contentLength / 4);
}

/**
 * Calculate total token count for messages.
 */
function calculateTotalTokens(messages: CollapsibleMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summarization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default summarization: extract key information from messages.
 */
function defaultSummarize(messages: CollapsibleMessage[]): string {
  const toolCalls = messages.filter(m => m.metadata?.toolName);
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  const parts: string[] = [];

  if (userMessages.length > 0) {
    parts.push(`User asked ${userMessages.length} questions`);
  }

  if (assistantMessages.length > 0) {
    parts.push(`Assistant provided ${assistantMessages.length} responses`);
  }

  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map(m => m.metadata?.toolName as string))];
    parts.push(`Used tools: ${toolNames.join(', ')}`);
  }

  // Extract key topics from content
  const allContent = messages.map(m => m.content).join(' ');
  const words = allContent.split(/\s+/).slice(0, 20);
  if (words.length > 0) {
    parts.push(`Topics: ${words.join(' ')}...`);
  }

  return parts.join('. ') || `[Collapsed ${messages.length} messages]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage Division
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Divide messages into stages for progressive collapse.
 */
function divideIntoStages(
  messages: CollapsibleMessage[],
  options: ContextCollapseOptions
): CollapseStage[] {
  const {
    preserveRecent = 10,
    keepMiddle = 20,
  } = options;

  const stages: CollapseStage[] = [];

  // Recent stage (preserve intact)
  const recentStart = Math.max(0, messages.length - preserveRecent);
  if (recentStart < messages.length) {
    stages.push({
      name: 'recent',
      messages: messages.slice(recentStart),
      startIndex: recentStart,
      endIndex: messages.length,
    });
  }

  // Middle stage (keep compressed)
  const middleStart = Math.max(0, recentStart - keepMiddle);
  if (middleStart < recentStart) {
    stages.push({
      name: 'middle',
      messages: messages.slice(middleStart, recentStart),
      startIndex: middleStart,
      endIndex: recentStart,
    });
  }

  // Old stage (collapse into summary)
  if (middleStart > 0) {
    stages.push({
      name: 'old',
      messages: messages.slice(0, middleStart),
      startIndex: 0,
      endIndex: middleStart,
    });
  }

  return stages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapse Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collapse a stage into a summary message.
 */
async function collapseStage(
  stage: CollapseStage,
  summarize?: (messages: CollapsibleMessage[]) => Promise<string>
): Promise<{ summary: CollapsibleMessage; entry: CommitLogEntry }> {
  const tokenEstimate = calculateTotalTokens(stage.messages);
  const summaryText = summarize
    ? await summarize(stage.messages)
    : defaultSummarize(stage.messages);

  const summaryMessage: CollapsibleMessage = {
    role: 'system',
    content: `[Collapse:${stage.name}] ${summaryText}`,
    metadata: {
      type: 'context_collapse',
      stage: stage.name,
      originalMessageCount: stage.messages.length,
      originalTokenEstimate: tokenEstimate,
      startIndex: stage.startIndex,
      endIndex: stage.endIndex,
    },
  };

  const entry: CommitLogEntry = {
    stage: stage.name,
    messageCount: stage.messages.length,
    tokenEstimate,
    summary: summaryText,
    timestamp: new Date(),
  };

  return { summary: summaryMessage, entry };
}

/**
 * Compress middle stage messages.
 */
function compressMiddleStage(messages: CollapsibleMessage[]): CollapsibleMessage[] {
  // Keep every other message and compress content
  return messages.filter((_, index) => index % 2 === 0).map(msg => ({
    ...msg,
    content: msg.content.length > 200
      ? msg.content.slice(0, 100) + '... [compressed] ...' + msg.content.slice(-100)
      : msg.content,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply progressive context collapse to messages.
 */
export async function contextCollapse(
  messages: CollapsibleMessage[],
  options: ContextCollapseOptions = {}
): Promise<ContextCollapseResult> {
  const {
    maxTokenBudget = 50000,
    includeCommitLog = true,
  } = options;

  logger.debug('[ContextCollapse] Starting context collapse', {
    messageCount: messages.length,
    totalTokens: calculateTotalTokens(messages),
    maxTokenBudget,
  });

  // Check if collapse is needed
  const currentTokens = calculateTotalTokens(messages);
  if (currentTokens <= maxTokenBudget) {
    logger.debug('[ContextCollapse] No collapse needed', { currentTokens, maxTokenBudget });
    return {
      messages,
      commitLog: [],
      tokenSavings: 0,
      collapsed: false,
      originalCount: messages.length,
      newCount: messages.length,
    };
  }

  // Divide into stages
  const stages = divideIntoStages(messages, options);
  const commitLog: CommitLogEntry[] = [];
  const collapsedMessages: CollapsibleMessage[] = [];

  // Process stages from old to recent
  for (const stage of stages) {
    if (stage.name === 'old') {
      // Collapse old stage into summary
      const { summary, entry } = await collapseStage(stage, options.summarize);
      collapsedMessages.push(summary);
      commitLog.push(entry);
    } else if (stage.name === 'middle') {
      // Compress middle stage
      const compressed = compressMiddleStage(stage.messages);
      collapsedMessages.push(...compressed);

      commitLog.push({
        stage: 'middle',
        messageCount: stage.messages.length - compressed.length,
        tokenEstimate: calculateTotalTokens(stage.messages) - calculateTotalTokens(compressed),
        summary: `Compressed ${stage.messages.length} messages to ${compressed.length}`,
        timestamp: new Date(),
      });
    } else {
      // Keep recent stage intact
      collapsedMessages.push(...stage.messages);
    }
  }

  // Add commit log as final message if enabled
  if (includeCommitLog && commitLog.length > 0) {
    const logContent = commitLog.map(entry =>
      `[${entry.stage}] Collapsed ${entry.messageCount} messages (~${entry.tokenEstimate} tokens): ${entry.summary}`
    ).join('\n');

    collapsedMessages.push({
      role: 'system',
      content: `[ContextCollapse:CommitLog]\n${logContent}`,
      metadata: {
        type: 'commit_log',
        entries: commitLog,
      },
    });
  }

  const newTokens = calculateTotalTokens(collapsedMessages);
  const tokenSavings = currentTokens - newTokens;

  logger.debug('[ContextCollapse] Collapse complete', {
    originalCount: messages.length,
    newCount: collapsedMessages.length,
    tokenSavings,
    collapsedStages: commitLog.length,
  });

  return {
    messages: collapsedMessages,
    commitLog,
    tokenSavings,
    collapsed: true,
    originalCount: messages.length,
    newCount: collapsedMessages.length,
  };
}

export default contextCollapse;