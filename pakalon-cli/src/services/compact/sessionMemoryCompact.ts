import type { Message } from "@/types/message.js";
import { estimateMessagesTokens, estimateMessageTokens, normalizeContentToText } from "./tokenEstimation.js";

export interface SessionMemoryCompactState {
  sessionId?: string;
  tokenCountBefore: number;
  tokenCountAfter: number;
  retainedCount: number;
  retainedMessages: Message[];
  summaryMessage?: Message;
  normalizedMessages: Message[];
}

export interface SessionMemoryCompactOptions {
  sessionId?: string;
  maxTokens?: number;
  keepTail?: number;
  maxRetainedMessages?: number;
  minMemoryChars?: number;
  preserveSystemMessages?: boolean;
  retainToolResults?: number;
  retainUserMessages?: number;
}

export interface SessionMemoryCompactResult {
  messages: Message[];
  compacted: boolean;
  memoryInjected: boolean;
  savedTokens: number;
  summary?: string;
  state: SessionMemoryCompactState;
}

const DEFAULT_KEEP_TAIL = 8;
const DEFAULT_MIN_MEMORY_CHARS = 120;
const DEFAULT_MAX_RETAINED_MESSAGES = 18;

function isSystemMessage(message: Message): boolean {
  return message.type === "system" || Boolean((message as { subtype?: unknown }).subtype);
}

function isToolMessage(message: Message): boolean {
  const kind = String((message as { type?: unknown }).type ?? "").toLowerCase();
  return kind === "tool" || kind === "tool_result" || Boolean((message as { toolUseId?: unknown }).toolUseId);
}

function scoreMessage(message: Message): number {
  if (isSystemMessage(message)) return 100;
  if (isToolMessage(message)) return 80;
  if (message.type === "assistant") return 60;
  if (message.type === "user") return 50;
  return 20;
}

function normalizeMessages(messages: readonly Message[]): Message[] {
  return [...messages].map((message) => ({
    ...message,
    timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
  }));
}

function summarizeSession(messages: Message[], maxLength = 2_000): string {
  const lines: string[] = ["## Session Memory Summary", ""];
  for (const message of messages.slice(-12)) {
    const text = normalizeContentToText((message as { content?: unknown }).content).trim();
    if (!text) continue;
    lines.push(`- ${message.type}: ${text.slice(0, 160)}`);
  }
  return lines.join("\n").slice(0, maxLength);
}

function chooseRetainedMessages(messages: Message[], options: SessionMemoryCompactOptions): Message[] {
  const keepTail = Math.max(1, options.keepTail ?? DEFAULT_KEEP_TAIL);
  const maxRetained = Math.max(keepTail, options.maxRetainedMessages ?? DEFAULT_MAX_RETAINED_MESSAGES);
  const preservedSystem = options.preserveSystemMessages !== false ? messages.filter(isSystemMessage) : [];
  const nonSystem = messages.filter((message) => !isSystemMessage(message));
  const scored = nonSystem
    .map((message, index) => ({ message, score: scoreMessage(message), index }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, maxRetained - preservedSystem.length)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.message);
  const tail = nonSystem.slice(-keepTail);
  return [...preservedSystem, ...scored, ...tail].filter((message, index, array) => array.indexOf(message) === index);
}

export function compactSessionMemory(
  sessionMessages: readonly Message[],
  options: SessionMemoryCompactOptions = {},
): SessionMemoryCompactResult {
  const normalized = normalizeMessages(sessionMessages);
  const before = estimateMessagesTokens(normalized);
  const maxTokens = options.maxTokens ?? before;

  if (before <= maxTokens) {
    return {
      messages: normalized,
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
      state: {
        sessionId: options.sessionId,
        tokenCountBefore: before,
        tokenCountAfter: before,
        retainedCount: normalized.length,
        retainedMessages: normalized,
        normalizedMessages: normalized,
      },
    };
  }

  const summary = summarizeSession(normalized);
  if (summary.replace(/\s+/g, "").length < (options.minMemoryChars ?? DEFAULT_MIN_MEMORY_CHARS)) {
    return {
      messages: normalized,
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
      state: {
        sessionId: options.sessionId,
        tokenCountBefore: before,
        tokenCountAfter: before,
        retainedCount: normalized.length,
        retainedMessages: normalized,
        normalizedMessages: normalized,
      },
    };
  }

  const retainedMessages = chooseRetainedMessages(normalized, options);
  const summaryMessage: Message = {
    type: "system",
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    subtype: "session_memory_summary",
    content: summary,
  };

  const nextMessages = [...retainedMessages, summaryMessage];
  const after = estimateMessagesTokens(nextMessages);
  if (after >= before) {
    return {
      messages: normalized,
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
      state: {
        sessionId: options.sessionId,
        tokenCountBefore: before,
        tokenCountAfter: before,
        retainedCount: normalized.length,
        retainedMessages: normalized,
        summaryMessage,
        normalizedMessages: normalized,
      },
    };
  }

  return {
    messages: nextMessages,
    compacted: true,
    memoryInjected: true,
    savedTokens: before - after,
    summary,
    state: {
      sessionId: options.sessionId,
      tokenCountBefore: before,
      tokenCountAfter: after,
      retainedCount: nextMessages.length,
      retainedMessages,
      summaryMessage,
      normalizedMessages: normalized,
    },
  };
}

export async function trySessionMemoryCompaction(
  messages: readonly Message[],
  optionsOrSessionId?: SessionMemoryCompactOptions | string,
): Promise<SessionMemoryCompactResult> {
  const options = typeof optionsOrSessionId === "string" ? { sessionId: optionsOrSessionId } : (optionsOrSessionId ?? {});
  return compactSessionMemory(messages, options);
}

export function estimateSessionMemoryTokens(messages: readonly Message[]): number {
  return estimateMessagesTokens([...messages]);
}
