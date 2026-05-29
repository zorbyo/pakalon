import type { ModelMessage as CoreMessage } from "ai";
import { estimateMessagesTokens } from "@/ai/context.js";

export interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ContextWindowConfig {
  modelContextWindow: number;
  maxOutputTokens: number;
  autoCompactBuffer: number;
  manualCompactBuffer: number;
  warningThresholdBuffer: number;
  errorThresholdBuffer: number;
  effectiveWindow: number;
}

export type PressureZone = "green" | "yellow" | "red" | "black";

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "anthropic/claude-3.5-sonnet": 200000,
  "anthropic/claude-3.5-haiku": 200000,
  "anthropic/claude-3-opus": 200000,
  "openai/gpt-4o": 128000,
  "openai/gpt-4-turbo": 128000,
  "google/gemini-pro-1.5": 1000000,
};

const DEFAULT_MODEL_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_AUTO_COMPACT_BUFFER = 13000;
const DEFAULT_MANUAL_COMPACT_BUFFER = 3000;
const DEFAULT_WARNING_THRESHOLD_BUFFER = 20000;
const DEFAULT_ERROR_THRESHOLD_BUFFER = 20000;

const TOKENS_PER_CHAR_ESTIMATE = 1 / 4;
const CONSERVATIVE_PADDING = 4 / 3;
const MESSAGE_OVERHEAD_TOKENS = 4;

function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}

function resolveModelContextWindow(model: string): number {
  const normalized = normalizeModelKey(model);
  const exact = MODEL_CONTEXT_WINDOWS[normalized];
  if (exact !== undefined) return exact;

  for (const [knownModel, contextWindow] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    const known = knownModel.toLowerCase();
    if (normalized === known || normalized.startsWith(`${known}/`) || normalized.startsWith(`${known}:`) || normalized.startsWith(`${known}@`)) {
      return contextWindow;
    }
  }

  return DEFAULT_MODEL_CONTEXT_WINDOW;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";

        const block = part as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") return block.text;
        if (block.type === "tool_result" && typeof block.content === "string") return block.content;
        if (block.type === "tool_use") {
          const input = block.input;
          const serializedInput = input === undefined ? "" : JSON.stringify(input);
          return `${typeof block.name === "string" ? block.name : ""}: ${serializedInput.slice(0, 200)}`;
        }
        if (typeof block.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    const block = content as Record<string, unknown>;
    if (typeof block.text === "string") return block.text;
  }

  return "";
}

function getMessageRole(message: CoreMessage): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function getMessageId(message: CoreMessage): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const id = (message as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function estimateMessageTokens(message: CoreMessage): number {
  const text = extractTextContent((message as Record<string, unknown>).content);
  if (!text) return MESSAGE_OVERHEAD_TOKENS;

  const roughTokens = text.length * TOKENS_PER_CHAR_ESTIMATE;
  return Math.ceil((roughTokens + MESSAGE_OVERHEAD_TOKENS) * CONSERVATIVE_PADDING);
}

function sumUsageTokens(usage: UsageMetrics): number {
  return (
    usage.inputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens +
    usage.outputTokens
  );
}

export function getEffectiveContextWindow(model: string): ContextWindowConfig {
  const modelContextWindow = resolveModelContextWindow(model);
  const maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS;
  const effectiveWindow = Math.max(0, modelContextWindow - maxOutputTokens);

  return {
    modelContextWindow,
    maxOutputTokens,
    autoCompactBuffer: DEFAULT_AUTO_COMPACT_BUFFER,
    manualCompactBuffer: DEFAULT_MANUAL_COMPACT_BUFFER,
    warningThresholdBuffer: DEFAULT_WARNING_THRESHOLD_BUFFER,
    errorThresholdBuffer: DEFAULT_ERROR_THRESHOLD_BUFFER,
    effectiveWindow,
  };
}

export function getAutoCompactThreshold(config: ContextWindowConfig): number {
  return Math.max(0, config.effectiveWindow - config.autoCompactBuffer);
}

export function getBlockingLimit(config: ContextWindowConfig): number {
  return Math.max(0, config.effectiveWindow - config.manualCompactBuffer);
}

function getWarningThreshold(config: ContextWindowConfig): number {
  return Math.max(0, config.effectiveWindow - config.warningThresholdBuffer);
}

function getErrorThreshold(config: ContextWindowConfig): number {
  return Math.max(0, config.effectiveWindow - config.errorThresholdBuffer);
}

export function calculateTokenWarningState(
  currentTokens: number,
  config: ContextWindowConfig,
): PressureZone {
  const remainingTokens = Math.max(0, config.effectiveWindow - currentTokens);

  if (remainingTokens <= config.manualCompactBuffer) return "black";
  if (remainingTokens <= config.autoCompactBuffer) return "red";
  if (remainingTokens <= config.warningThresholdBuffer) return "yellow";
  return "green";
}

export function tokenCountWithEstimation(
  messages: CoreMessage[],
  assistantUsageMap: Map<string, UsageMetrics> = new Map(),
): number {
  if (messages.length === 0) return 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || getMessageRole(message) !== "assistant") continue;

    const messageId = getMessageId(message);
    if (!messageId) continue;

    const usage = assistantUsageMap.get(messageId);
    if (!usage) continue;

    let firstSiblingIndex = index;
    while (firstSiblingIndex > 0) {
      const previous = messages[firstSiblingIndex - 1];
      if (!previous || getMessageId(previous) !== messageId) break;
      firstSiblingIndex -= 1;
    }

    const baselineTokens = sumUsageTokens(usage);
    const trailingMessages = messages.slice(index + 1);
    const trailingEstimate = trailingMessages.reduce((sum, trailingMessage) => sum + estimateMessageTokens(trailingMessage), 0);
    const siblingEstimate = messages
      .slice(firstSiblingIndex, index)
      .reduce((sum, siblingMessage) => sum + estimateMessageTokens(siblingMessage), 0);
    return baselineTokens + siblingEstimate + trailingEstimate;
  }

  return estimateMessagesTokens(messages);
}
