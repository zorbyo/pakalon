/**
 * AI compactor — auto-summarize conversation when approaching token limits.
 * Replaces Python bridge /agent/summarize endpoint.
 *
 * Matches Copilot CLI's context compaction feature.
 */
import logger from "@/utils/logger.js";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionOptions {
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  currentTokens: number;
  model?: string;
  apiKey?: string;
}

export interface CompactionResult {
  success: boolean;
  summary?: string;
  compactedMessages?: Array<{ role: string; content: string }>;
  tokensSaved?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count using the 1 token ≈ 4 chars heuristic.
 * For production, use tiktoken or model-specific tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in a message array.
 */
export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content) + 4; // +4 for role/metadata overhead
  }, 0);
}

// ---------------------------------------------------------------------------
// Auto-compaction Trigger
// ---------------------------------------------------------------------------

/**
 * Check if compaction should be triggered.
 */
export function shouldCompact(currentTokens: number, maxTokens: number): boolean {
  // Trigger at 80% of token limit
  return currentTokens > maxTokens * 0.8;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

/**
 * Compact a conversation by summarizing older messages.
 *
 * Strategy:
 * 1. Keep system message + last N messages intact
 * 2. Summarize the middle messages into a single summary message
 * 3. Return the compacted message array
 */
export async function compactConversation(options: CompactionOptions): Promise<CompactionResult> {
  const { messages, maxTokens, currentTokens, model, apiKey } = options;

  if (messages.length < 3) {
    return { success: false, error: "Too few messages to compact" };
  }

  try {
    // Separate system messages from conversation
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    // Keep first message (initial context) and last 4 messages
    const keepFirst = conversationMessages.slice(0, 1);
    const keepLast = conversationMessages.slice(-4);
    const toSummarize = conversationMessages.slice(1, -4);

    if (toSummarize.length === 0) {
      return { success: false, error: "Not enough messages to compact" };
    }

    // Build summary prompt
    const summaryPrompt = toSummarize
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n\n");

    let summary: string;

    if (apiKey) {
      // Use LLM for summarization
      summary = await llmSummarize(summaryPrompt, model, apiKey);
    } else {
      // Simple extractive summary
      summary = extractiveSummary(toSummarize);
    }

    const compactedMessages = [
      ...systemMessages,
      ...keepFirst,
      {
        role: "system" as const,
        content: `[Context Summary from ${toSummarize.length} earlier messages]\n${summary}`,
      },
      ...keepLast,
    ];

    const newTokens = estimateMessageTokens(compactedMessages);
    const tokensSaved = currentTokens - newTokens;

    logger.info("[compactor] Compacted conversation", {
      originalMessages: messages.length,
      compactedMessages: compactedMessages.length,
      tokensSaved,
    });

    return {
      success: true,
      summary,
      compactedMessages,
      tokensSaved,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Summarize using LLM (via OpenRouter).
 */
async function llmSummarize(
  text: string,
  model: string | undefined,
  apiKey: string,
): Promise<string> {
  const provider = createOpenRouter({ apiKey });
  const result = await generateText({
    model: provider(model ?? "anthropic/claude-3.5-sonnet"),
    system: "Summarize the conversation concisely. Preserve decisions, code changes, file states, plans, blockers, and next actions.",
    messages: [{ role: "user", content: stripBinaryBlocks(text).slice(0, 10000) }],
    maxOutputTokens: 1000,
  });

  return result.text || "Summary not available";
}

function stripBinaryBlocks(text: string): string {
  return text
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi, "[image]")
    .replace(/data:application\/[a-z0-9.+-]+;base64,[a-z0-9+/=\r\n]+/gi, "[document]");
}

/**
 * Simple extractive summary (no LLM needed).
 */
function extractiveSummary(messages: Array<{ role: string; content: string }>): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const content = msg.content.slice(0, 200).replace(/\n/g, " ").trim();
    if (content.length > 20) {
      lines.push(`- ${msg.role}: ${content}`);
    }
  }

  return `Conversation covered ${messages.length} messages:\n${lines.slice(0, 10).join("\n")}`;
}

// ---------------------------------------------------------------------------
// Auto-compaction Hook
// ---------------------------------------------------------------------------

/**
 * Create a middleware that auto-compacts when token limit is approaching.
 */
export function createAutoCompactor(
  maxTokens: number,
  apiKey?: string,
  model?: string,
) {
  return async function autoCompact(
    messages: Array<{ role: string; content: string }>,
  ): Promise<Array<{ role: string; content: string }>> {
    const currentTokens = estimateMessageTokens(messages);

    if (!shouldCompact(currentTokens, maxTokens)) {
      return messages;
    }

    logger.info("[compactor] Auto-compaction triggered", {
      currentTokens,
      maxTokens,
      threshold: maxTokens * 0.8,
    });

    const result = await compactConversation({
      messages,
      maxTokens,
      currentTokens,
      model,
      apiKey,
    });

    if (result.success && result.compactedMessages) {
      return result.compactedMessages;
    }

    return messages;
  };
}
