import type { CoreMessage } from "ai";
import { estimateMessagesTokens, loadMemoryFiles } from "@/ai/context.js";

export interface SessionMemoryCompactionOptions {
  maxTokens: number;
  projectDir?: string;
  keepTail?: number;
  minMemoryChars?: number;
}

export interface SessionMemoryCompactionResult {
  messages: CoreMessage[];
  compacted: boolean;
  memoryInjected: boolean;
  savedTokens: number;
}

const DEFAULT_KEEP_TAIL = 8;
const DEFAULT_MIN_MEMORY_CHARS = 120;

function createMemoryMessage(memoryText: string): CoreMessage {
  return {
    role: "system",
    content: `<session-memory>\n${memoryText}\n</session-memory>`,
  } as CoreMessage;
}

export function trySessionMemoryCompaction(
  messages: readonly CoreMessage[],
  options: SessionMemoryCompactionOptions,
): SessionMemoryCompactionResult {
  const before = estimateMessagesTokens([...messages]);
  if (before <= options.maxTokens) {
    return {
      messages: [...messages],
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
    };
  }

  const memoryText = loadMemoryFiles(options.projectDir).join("\n\n---\n\n");
  if (memoryText.trim().length < (options.minMemoryChars ?? DEFAULT_MIN_MEMORY_CHARS)) {
    return {
      messages: [...messages],
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
    };
  }

  const keepTail = Math.max(1, options.keepTail ?? DEFAULT_KEEP_TAIL);
  const systemMessages = messages.filter((message) => (message as { role?: string }).role === "system");
  const tail = messages.filter((message) => (message as { role?: string }).role !== "system").slice(-keepTail);
  const compacted = [...systemMessages, createMemoryMessage(memoryText), ...tail];
  const after = estimateMessagesTokens(compacted);

  if (after >= before) {
    return {
      messages: [...messages],
      compacted: false,
      memoryInjected: false,
      savedTokens: 0,
    };
  }

  return {
    messages: compacted,
    compacted: true,
    memoryInjected: true,
    savedTokens: before - after,
  };
}
