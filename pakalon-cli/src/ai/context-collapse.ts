import type { CoreMessage } from "ai";
import { estimateMessagesTokens } from "@/ai/context.js";

export interface CommandKind {
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
}

export interface ContextCollapseOptions {
  minSequenceLength?: number;
  maxInlineChars?: number;
}

export interface ContextCollapseResult {
  messages: CoreMessage[];
  changed: boolean;
  collapsedMessages: number;
  estimatedTokensSaved: number;
}

const SEARCH_NAMES = new Set(["grep", "grepsearch", "rg", "websearch", "glob", "globfind", "find"]);
const READ_NAMES = new Set(["read", "readfile", "read_file", "view", "webfetch", "cat"]);
const LIST_NAMES = new Set(["ls", "list", "listdir", "directory", "tree"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[-_\s]/g, "").toLowerCase() : "";
}

export function isSearchOrReadCommand(input: unknown): CommandKind {
  if (!isRecord(input)) {
    const name = normalizeName(input);
    return {
      isSearch: SEARCH_NAMES.has(name),
      isRead: READ_NAMES.has(name),
      isList: LIST_NAMES.has(name),
    };
  }

  const rawName = input.toolName ?? input.tool_name ?? input.name ?? input.command ?? "";
  const name = normalizeName(rawName);
  const commandText = typeof input.command === "string" ? input.command.toLowerCase() : "";

  return {
    isSearch: SEARCH_NAMES.has(name) || /\b(rg|grep|findstr|select-string)\b/.test(commandText),
    isRead: READ_NAMES.has(name) || /\b(cat|type|sed|get-content)\b/.test(commandText),
    isList: LIST_NAMES.has(name) || /\b(ls|dir|tree|get-childitem)\b/.test(commandText),
  };
}

function getToolResultText(message: CoreMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (typeof part.content === "string") return part.content;
      if (typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isSearchReadMessage(message: CoreMessage): boolean {
  const direct = isSearchOrReadCommand(message);
  if (direct.isSearch || direct.isRead || direct.isList) return true;

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!isRecord(part)) return false;
    const kind = isSearchOrReadCommand(part);
    return kind.isSearch || kind.isRead || kind.isList;
  });
}

function collapseMessage(message: CoreMessage, maxInlineChars: number): CoreMessage {
  const text = getToolResultText(message);
  const preview = text.length > maxInlineChars ? `${text.slice(0, maxInlineChars)}\n...` : text;
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  return {
    ...message,
    content: `[Collapsed search/read result: ${lineCount} lines, ${text.length} chars]\n${preview}`,
  } as CoreMessage;
}

export function collapseSearchReadSequences(
  messages: readonly CoreMessage[],
  options: ContextCollapseOptions = {},
): ContextCollapseResult {
  const minSequenceLength = Math.max(2, options.minSequenceLength ?? 3);
  const maxInlineChars = Math.max(200, options.maxInlineChars ?? 800);
  const before = estimateMessagesTokens([...messages]);
  const next = [...messages];
  let collapsed = 0;
  let sequence: number[] = [];

  const flush = () => {
    if (sequence.length >= minSequenceLength) {
      for (const index of sequence.slice(0, -1)) {
        next[index] = collapseMessage(next[index]!, maxInlineChars);
        collapsed += 1;
      }
    }
    sequence = [];
  };

  next.forEach((message, index) => {
    if (isSearchReadMessage(message)) {
      sequence.push(index);
    } else {
      flush();
    }
  });
  flush();

  const after = estimateMessagesTokens(next);
  return {
    messages: next,
    changed: collapsed > 0,
    collapsedMessages: collapsed,
    estimatedTokensSaved: Math.max(0, before - after),
  };
}
