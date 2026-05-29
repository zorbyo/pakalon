/**
 * Compaction Preparation — Find cut points and prepare context for compaction.
 *
 * Implements Claude Code-style compaction preparation:
 * - findCutPoint(): Find the optimal point to cut messages for summarization
 * - prepareCompaction(): Mark messages for compaction and calculate savings
 * - estimateTokens(): Accurate token estimation for compaction decisions
 *
 * This works with the existing compaction infrastructure (context-manager.ts,
 * compactor.ts, auto-compaction.ts, microcompact.ts) to provide the
 * "preparation" step that was missing.
 *
 * Usage:
 *   const cutPoint = findCutPoint(messages, maxTokens);
 *   const prep = prepareCompaction(messages, cutPoint);
 *   // prep.summarizable contains the messages to summarize
 *   // prep.keep contains the messages to keep intact
 */

import type { CoreMessage } from "ai";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CutPointResult {
  /** Index where the cut should happen */
  index: number;
  /** Reason for choosing this cut point */
  reason: string;
  /** Estimated tokens before the cut point */
  tokensBefore: number;
  /** Estimated tokens after the cut point */
  tokensAfter: number;
  /** Messages that will be summarized (before cut) */
  summarizableCount: number;
  /** Messages that will be kept (after cut) */
  keepCount: number;
}

export interface CompactionPreparation {
  /** Messages that should be summarized */
  summarizable: CoreMessage[];
  /** Messages that should be kept intact */
  keep: CoreMessage[];
  /** Messages in the summarizable set that are tool results (eligible for micro-compaction) */
  toolResults: ToolResultInfo[];
  /** Cut point info */
  cutPoint: CutPointResult;
  /** Estimated tokens saved */
  estimatedTokensSaved: number;
  /** Optimal summarization strategy */
  suggestedStrategy: "summarize" | "microcompact" | "both";
}

export interface ToolResultInfo {
  messageIndex: number;
  toolName?: string;
  tokenCount: number;
  /** Whether this tool result is a good candidate for micro-compaction */
  compactable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Estimation
// ─────────────────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(messages: CoreMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);
    total += estimateTokens(content) + 4; // +4 for role/metadata
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cut Point Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the optimal cut point in a list of messages for compaction.
 *
 * Strategy:
 * 1. Always keep system messages
 * 2. Keep the last N messages (recent context) intact
 * 3. Find a natural cut point (between turns, at tool results, or at boundaries)
 * 4. Prioritize cutting old tool results over user/assistant messages
 *
 * @param messages - The full message list
 * @param maxTokens - Maximum token budget
 * @param keepLastCount - Number of recent messages to keep (default: 10)
 * @returns Cut point information
 */
export function findCutPoint(
  messages: CoreMessage[],
  maxTokens: number,
  keepLastCount = 10,
): CutPointResult {
  const totalTokens = estimateMessageTokens(messages);

  // No compaction needed if within budget
  if (totalTokens <= maxTokens) {
    return {
      index: 0,
      reason: "Within token budget",
      tokensBefore: 0,
      tokensAfter: totalTokens,
      summarizableCount: 0,
      keepCount: messages.length,
    };
  }

  // Find system messages (must keep)
  const systemCount = messages.filter((m) => m.role === "system").length;

  // Calculate how many messages we need to cut
  const targetTokens = maxTokens * 0.7; // Target 70% for safety margin
  let cutIndex = systemCount; // Start after system messages
  let tokensToCut = totalTokens - targetTokens;
  let accumulatedTokens = 0;

  // Scan from oldest non-system message, accumulating tokens
  for (let i = systemCount; i < messages.length - keepLastCount; i++) {
    const msg = messages[i]!;
    const msgTokens = estimateMessageTokens([msg]);
    accumulatedTokens += msgTokens;

    if (accumulatedTokens >= tokensToCut) {
      // Found our cut point
      cutIndex = i + 1;
      break;
    }
  }

  // Refine: find a natural boundary (end of a turn)
  cutIndex = refineCutPoint(messages, cutIndex);

  const summarizable = messages.slice(0, cutIndex);
  const keep = messages.slice(cutIndex);
  const tokensBefore = estimateMessageTokens(summarizable);
  const tokensAfter = estimateMessageTokens(keep);

  const reasons: string[] = [];
  if (cutIndex <= systemCount) {
    reasons.push("Only system messages would be kept");
  }
  if (cutIndex >= messages.length - keepLastCount) {
    reasons.push("Near the end — minimal compaction possible");
  }
  reasons.push(`Cut after ${cutIndex} messages`);

  return {
    index: cutIndex,
    reason: reasons.join("; "),
    tokensBefore,
    tokensAfter,
    summarizableCount: summarizable.filter((m) => m.role !== "system").length,
    keepCount: keep.length,
  };
}

/**
 * Refine cut point to a natural boundary.
 * Prefers boundaries between assistant→user turns or at tool results.
 */
function refineCutPoint(
  messages: CoreMessage[],
  proposedIndex: number,
): number {
  if (messages.length === 0) return 0;

  // Ensure we don't cut in the middle of a turn
  // A turn ends when we see assistant → user transition
  for (let i = proposedIndex; i < messages.length; i++) {
    const current = messages[i];
    const next = messages[i + 1];

    if (!current || !next) break;

    // Prefer cutting at assistant → user boundary (end of assistant turn)
    if (
      current.role === "assistant" &&
      (next.role === "user" || next.role === "system")
    ) {
      return i + 1; // Cut after the assistant message
    }

    // Also good: tool → user boundary
    if (
      current.role === "tool" &&
      next.role === "user"
    ) {
      return i + 1;
    }
  }

  // Fallback: use the proposed index
  // But ensure we don't cut inside a tool-result group
  for (let i = proposedIndex; i > 0; i--) {
    if (messages[i]?.role !== "tool") {
      return Math.max(1, i);
    }
  }

  return proposedIndex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compaction Preparation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepare messages for compaction by identifying what can be summarized,
 * what should be micro-compacted, and what must be kept intact.
 */
export function prepareCompaction(
  messages: CoreMessage[],
  cutPoint?: CutPointResult,
): CompactionPreparation {
  const maxTokens = 128000; // Default context window
  const cut = cutPoint ?? findCutPoint(messages, maxTokens);

  const summarizable = messages.slice(0, cut.index);
  const keep = messages.slice(cut.index);

  // Identify tool results in the summarizable set
  const toolResults: ToolResultInfo[] = [];
  for (let i = 0; i < summarizable.length; i++) {
    const msg = summarizable[i]!;
    if (msg.role === "tool") {
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      const tokenCount = estimateTokens(content);

      toolResults.push({
        messageIndex: i,
        toolName: extractToolName(msg),
        tokenCount,
        compactable: tokenCount > 100, // Only compact large results
      });
    }
  }

  // Determine strategy
  const largeToolResults = toolResults.filter((t) => t.compactable);
  const totalToolTokens = largeToolResults.reduce((s, t) => s + t.tokenCount, 0);
  const totalSummarizableTokens = estimateMessageTokens(summarizable);

  let suggestedStrategy: "summarize" | "microcompact" | "both";

  if (largeToolResults.length >= 3 && totalToolTokens > totalSummarizableTokens * 0.5) {
    suggestedStrategy = "microcompact";
  } else if (summarizable.length > 5) {
    suggestedStrategy = "summarize";
  } else {
    suggestedStrategy = "both";
  }

  return {
    summarizable,
    keep,
    toolResults,
    cutPoint: cut,
    estimatedTokensSaved: cut.tokensBefore,
    suggestedStrategy,
  };
}

/**
 * Extract tool name from a tool result message.
 */
function extractToolName(msg: CoreMessage): string | undefined {
  if (typeof msg.content === "object" && msg.content !== null) {
    const parts = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const part of parts) {
      if (typeof part === "object" && part !== null) {
        const p = part as Record<string, unknown>;
        if (p.toolName) return String(p.toolName);
        if (p.tool_name) return String(p.tool_name);
        if (p.name) return String(p.name);
      }
    }
  }
  return undefined;
}

/**
 * Estimate how many tokens would be saved by micro-compacting tool results.
 */
export function estimateMicrocompactSavings(
  preparation: CompactionPreparation,
): number {
  const compactable = preparation.toolResults.filter((t) => t.compactable);
  // Micro-compacting replaces tool results with a short placeholder
  const placeholderTokens = 10; // "[Old tool result content cleared...]"
  return compactable.reduce(
    (savings, t) => savings + Math.max(0, t.tokenCount - placeholderTokens),
    0,
  );
}
