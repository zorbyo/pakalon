import type { Message } from "@/types/message.js";

export interface TokenEstimationConfig {
  charTokensRatio?: number;
  messageOverhead?: number;
}

const DEFAULT_RATIO = 4;
const DEFAULT_MESSAGE_OVERHEAD = 4;

export function normalizeContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (typeof record.content === "string") return record.content;
          if (typeof record.type === "string" && record.type.includes("tool")) return JSON.stringify(record).slice(0, 2_000);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    return JSON.stringify(record);
  }
  return content === undefined || content === null ? "" : String(content);
}

export function estimateTextTokens(text: string, config: TokenEstimationConfig = {}): number {
  if (!text) return 0;
  const ratio = config.charTokensRatio ?? DEFAULT_RATIO;
  return Math.ceil(text.length / Math.max(1, ratio));
}

export function estimateToolResultTokens(result: unknown, config: TokenEstimationConfig = {}): number {
  return estimateTextTokens(normalizeContentToText(result), config);
}

export function estimateMessageTokens(message: Message, config: TokenEstimationConfig = {}): number {
  const content = normalizeContentToText((message as { content?: unknown }).content);
  return estimateTextTokens(content, config) + (config.messageOverhead ?? DEFAULT_MESSAGE_OVERHEAD);
}

export function estimateMessagesTokens(messages: readonly Message[], config: TokenEstimationConfig = {}): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message, config), 0);
}
