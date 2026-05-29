import type { CoreMessage } from "ai";
import { estimateMessagesTokens } from "@/ai/context.js";

export interface ToolResultReference {
  messageIndex: number;
  partIndex: number | null;
  toolUseId?: string;
  toolName?: string;
  text: string;
}

export interface MicrocompactOptions {
  keepLatestToolResults?: number;
  placeholder?: string;
  minResultChars?: number;
  compactableToolNames?: readonly string[];
}

export interface MicrocompactResult {
  messages: CoreMessage[];
  changed: boolean;
  clearedResults: number;
  estimatedTokensSaved: number;
  cacheEditToolUseIds: string[];
}

const DEFAULT_KEEP_LATEST_TOOL_RESULTS = 12;
const DEFAULT_MIN_RESULT_CHARS = 200;
const DEFAULT_PLACEHOLDER = "[Old tool result content cleared by microcompact]";

const DEFAULT_COMPACTABLE_TOOL_NAMES = new Set([
  "readfile",
  "read_file",
  "view",
  "bash",
  "powershell",
  "grep",
  "grepsearch",
  "glob",
  "globfind",
  "rg",
  "webfetch",
  "websearch",
  "editfile",
  "writefile",
  "multieditfiles",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(textFromValue).filter(Boolean).join("\n");
  }
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    return JSON.stringify(value);
  }
  return value === undefined || value === null ? "" : String(value);
}

function isToolResultPart(part: unknown): part is Record<string, unknown> {
  if (!isRecord(part)) return false;
  const type = String(part.type ?? "").toLowerCase();
  return type === "tool_result" || type === "tool-result";
}

function toolNameForPart(part: Record<string, unknown>): string | undefined {
  const name = part.toolName ?? part.tool_name ?? part.name;
  return typeof name === "string" ? name : undefined;
}

function toolUseIdForPart(part: Record<string, unknown>): string | undefined {
  const id = part.toolUseId ?? part.tool_use_id ?? part.id;
  return typeof id === "string" ? id : undefined;
}

function isCompactableTool(toolName: string | undefined, allowed: Set<string>): boolean {
  if (!toolName) return true;
  return allowed.has(toolName.toLowerCase());
}

export function collectToolResultReferences(
  messages: readonly CoreMessage[],
  options: Pick<MicrocompactOptions, "compactableToolNames" | "minResultChars"> = {},
): ToolResultReference[] {
  const compactableNames = options.compactableToolNames
    ? new Set(options.compactableToolNames.map((name) => name.toLowerCase()))
    : DEFAULT_COMPACTABLE_TOOL_NAMES;
  const minResultChars = options.minResultChars ?? DEFAULT_MIN_RESULT_CHARS;
  const refs: ToolResultReference[] = [];

  messages.forEach((message, messageIndex) => {
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      content.forEach((part, partIndex) => {
        if (!isToolResultPart(part)) return;
        const toolName = toolNameForPart(part);
        if (!isCompactableTool(toolName, compactableNames)) return;
        const text = textFromValue(part.content);
        if (text.length < minResultChars) return;
        refs.push({
          messageIndex,
          partIndex,
          toolName,
          toolUseId: toolUseIdForPart(part),
          text,
        });
      });
      return;
    }

    const toolName = (message as { toolName?: unknown }).toolName;
    const isToolResultMessage =
      (message as { toolUseId?: unknown }).toolUseId !== undefined ||
      (message as { type?: unknown }).type === "tool_result";
    if (!isToolResultMessage || !isCompactableTool(typeof toolName === "string" ? toolName : undefined, compactableNames)) {
      return;
    }
    const text = textFromValue(content);
    if (text.length < minResultChars) return;
    const messageToolUseId = (message as { toolUseId?: unknown }).toolUseId;
    refs.push({
      messageIndex,
      partIndex: null,
      toolName: typeof toolName === "string" ? toolName : undefined,
      toolUseId: typeof messageToolUseId === "string" ? messageToolUseId : undefined,
      text,
    });
  });

  return refs;
}

function clearToolResultPart(part: Record<string, unknown>, placeholder: string): Record<string, unknown> {
  return {
    ...part,
    content: placeholder,
    microcompactCleared: true,
  };
}

function clearMessageContent(message: CoreMessage, ref: ToolResultReference, placeholder: string): CoreMessage {
  const content = (message as { content?: unknown }).content;
  if (ref.partIndex !== null && Array.isArray(content)) {
    const nextContent = content.map((part, index) => {
      if (index !== ref.partIndex || !isRecord(part)) return part;
      return clearToolResultPart(part, placeholder);
    });
    return { ...message, content: nextContent } as CoreMessage;
  }

  return { ...message, content: placeholder } as CoreMessage;
}

export function microcompactMessages(
  messages: readonly CoreMessage[],
  options: MicrocompactOptions = {},
): MicrocompactResult {
  const keepLatest = Math.max(0, options.keepLatestToolResults ?? DEFAULT_KEEP_LATEST_TOOL_RESULTS);
  const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;
  const refs = collectToolResultReferences(messages, options);
  const clearable = refs.slice(0, Math.max(0, refs.length - keepLatest));
  const cacheEditToolUseIds = clearable
    .map((ref) => ref.toolUseId)
    .filter((id): id is string => Boolean(id));

  if (clearable.length === 0) {
    return {
      messages: [...messages],
      changed: false,
      clearedResults: 0,
      estimatedTokensSaved: 0,
      cacheEditToolUseIds,
    };
  }

  const before = estimateMessagesTokens([...messages]);
  const clearableByMessage = new Map<number, ToolResultReference[]>();
  for (const ref of clearable) {
    const refsForMessage = clearableByMessage.get(ref.messageIndex) ?? [];
    refsForMessage.push(ref);
    clearableByMessage.set(ref.messageIndex, refsForMessage);
  }

  const nextMessages = messages.map((message, messageIndex) => {
    const refsForMessage = clearableByMessage.get(messageIndex);
    if (!refsForMessage?.length) return message;

    let next = message;
    for (const ref of refsForMessage) {
      next = clearMessageContent(next, ref, placeholder);
    }
    return next;
  });

  const after = estimateMessagesTokens(nextMessages);
  return {
    messages: nextMessages,
    changed: true,
    clearedResults: clearable.length,
    estimatedTokensSaved: Math.max(0, before - after),
    cacheEditToolUseIds,
  };
}
