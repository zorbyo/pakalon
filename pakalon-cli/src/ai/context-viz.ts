/**
 * Context Visualization — /context command implementation.
 *
 * Shows token usage breakdown matching Copilot CLI's /context display:
 * - Current context window usage
 * - Message count and token distribution
 * - Token usage bar
 * - Breakdown by message role
 */
import type { ChatMessage } from "@/store/slices/session.slice.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextStats {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
  usagePercent: number;
  messageCount: number;
  messagesByRole: {
    user: number;
    assistant: number;
    system: number;
    tool: number;
  };
  tokensByRole: {
    user: number;
    assistant: number;
    system: number;
    tool: number;
  };
  largestMessage: {
    role: string;
    tokens: number;
    preview: string;
  };
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text.
 * Uses ~4 chars per token heuristic (accurate for English).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Simple heuristic: 1 token ~ 4 chars for English, ~2 chars for CJK
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(otherChars / 4 + cjkChars / 2);
}

/**
 * Estimate tokens for a message.
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = estimateTokens(message.content);
  // Add overhead for role, metadata, etc.
  tokens += 10;
  // Add tokens for tool calls if present
  if (message.toolCalls) {
    tokens += estimateTokens(JSON.stringify(message.toolCalls));
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Context Stats Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate context statistics from messages.
 */
export function calculateContextStats(
  messages: ChatMessage[],
  maxContextTokens: number = 128000
): ContextStats {
  const messagesByRole = { user: 0, assistant: 0, system: 0, tool: 0 };
  const tokensByRole = { user: 0, assistant: 0, system: 0, tool: 0 };
  let totalTokens = 0;
  let largestMessage = { role: "", tokens: 0, preview: "" };

  for (const msg of messages) {
    const tokens = estimateMessageTokens(msg);
    totalTokens += tokens;

    if (msg.role in messagesByRole) {
      messagesByRole[msg.role as keyof typeof messagesByRole]++;
      tokensByRole[msg.role as keyof typeof tokensByRole] += tokens;
    }

    if (tokens > largestMessage.tokens) {
      largestMessage = {
        role: msg.role,
        tokens,
        preview: msg.content.slice(0, 100).replace(/\n/g, " "),
      };
    }
  }

  return {
    totalTokens: maxContextTokens,
    usedTokens: totalTokens,
    remainingTokens: Math.max(0, maxContextTokens - totalTokens),
    usagePercent: Math.round((totalTokens / maxContextTokens) * 100),
    messageCount: messages.length,
    messagesByRole,
    tokensByRole,
    largestMessage,
  };
}

// ---------------------------------------------------------------------------
// Display Formatters
// ---------------------------------------------------------------------------

/**
 * Format context stats as a text display for TUI.
 */
export function formatContextStats(stats: ContextStats): string {
  const barWidth = 30;
  const filled = Math.round((stats.usagePercent / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const lines = [
    "## Context Window",
    "",
    `[${bar}] ${stats.usagePercent}%`,
    "",
    `**Used:** ${formatNumber(stats.usedTokens)} tokens`,
    `**Remaining:** ${formatNumber(stats.remainingTokens)} tokens`,
    `**Total:** ${formatNumber(stats.totalTokens)} tokens`,
    "",
    "## Messages",
    "",
    `Total: ${stats.messageCount}`,
    "",
    "| Role | Count | Tokens |",
    "|------|-------|--------|",
    `| User | ${stats.messagesByRole.user} | ${formatNumber(stats.tokensByRole.user)} |`,
    `| Assistant | ${stats.messagesByRole.assistant} | ${formatNumber(stats.tokensByRole.assistant)} |`,
    `| System | ${stats.messagesByRole.system} | ${formatNumber(stats.tokensByRole.system)} |`,
    `| Tool | ${stats.messagesByRole.tool} | ${formatNumber(stats.tokensByRole.tool)} |`,
  ];

  if (stats.largestMessage.tokens > 0) {
    lines.push(
      "",
      "## Largest Message",
      "",
      `**Role:** ${stats.largestMessage.role}`,
      `**Tokens:** ${formatNumber(stats.largestMessage.tokens)}`,
      `**Preview:** ${stats.largestMessage.preview}...`,
    );
  }

  return lines.join("\n");
}

/**
 * Format context stats as a compact single-line summary.
 */
export function formatContextCompact(stats: ContextStats): string {
  const barWidth = 10;
  const filled = Math.round((stats.usagePercent / 100) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  return `[${bar}] ${stats.usagePercent}% (${formatNumber(stats.usedTokens)} / ${formatNumber(stats.totalTokens)} tokens, ${stats.messageCount} msgs)`;
}

/**
 * Format context stats as JSON for programmatic access.
 */
export function formatContextJson(stats: ContextStats): string {
  return JSON.stringify(stats, null, 2);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
