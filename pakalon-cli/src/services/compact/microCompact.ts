import type { Message } from "@/types/message.js";
import { groupMessages, getGroupTokenCount, selectGroupsForCompaction, type MessageGroup } from "./grouping.js";
import { estimateMessagesTokens, estimateMessageTokens, normalizeContentToText } from "./tokenEstimation.js";
import { getMCConfigForCurrentTime, getMCConfigForTimeWindow, type TimeBasedMCConfig } from "./timeBasedMCConfig.js";

export interface MicroCompactOptions {
  keepLatestToolResults?: number;
  placeholder?: string;
  minResultChars?: number;
  tokenBudget?: number;
  groupByTopic?: boolean;
  groupByToolUseId?: boolean;
  timeBasedConfig?: TimeBasedMCConfig;
  preserveSystemMessages?: boolean;
}

export interface MicroCompactResult {
  messages: Message[];
  changed: boolean;
  clearedResults: number;
  estimatedTokensSaved: number;
  cacheEditToolUseIds: string[];
  groupsCompacted: MessageGroup[];
}

const DEFAULT_KEEP_LATEST_TOOL_RESULTS = 12;
const DEFAULT_MIN_RESULT_CHARS = 200;
const DEFAULT_PLACEHOLDER = "[Old tool result content cleared by microcompact]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolResultMessage(message: Message): boolean {
  const kind = String((message as { type?: unknown }).type ?? "").toLowerCase();
  return kind === "tool_result" || kind === "tool" || Boolean((message as { toolUseId?: unknown }).toolUseId);
}

function messageToolUseId(message: Message): string | undefined {
  const value = (message as { toolUseId?: unknown }).toolUseId ?? (message as { tool_use_id?: unknown }).tool_use_id;
  return typeof value === "string" ? value : undefined;
}

function messageToolName(message: Message): string | undefined {
  const value = (message as { toolName?: unknown }).toolName ?? (message as { name?: unknown }).name;
  return typeof value === "string" ? value : undefined;
}

function clearMessageContent(message: Message, placeholder: string): Message {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return { ...message, content: placeholder };
  }
  if (Array.isArray(content)) {
    return {
      ...message,
      content: content.map((part) => {
        if (!isRecord(part)) return part;
        if (String(part.type ?? "").toLowerCase().includes("tool")) {
          return { ...part, content: placeholder, microcompactCleared: true };
        }
        return part;
      }),
    };
  }
  return { ...message, content: placeholder };
}

function shouldCompactGroup(group: MessageGroup, minResultChars: number): boolean {
  if (group.strategy === "system") return false;
  if (group.tokenCount <= minResultChars / 4) return false;
  return group.messages.some((message) => isToolResultMessage(message));
}

function buildPlaceholder(group: MessageGroup, placeholder: string): string {
  const toolName = group.toolUseId ?? group.topic ?? group.strategy;
  return `${placeholder} (${toolName})`;
}

function configForTime(options: MicroCompactOptions): TimeBasedMCConfig {
  return options.timeBasedConfig ?? getMCConfigForCurrentTime();
}

export function performMicroCompact(
  messages: readonly Message[],
  options: MicroCompactOptions = {},
): MicroCompactResult {
  const timeConfig = configForTime(options);
  const keepLatest = Math.max(
    0,
    options.keepLatestToolResults ?? timeConfig.keepLatestToolResults ?? DEFAULT_KEEP_LATEST_TOOL_RESULTS,
  );
  const placeholder = options.placeholder ?? timeConfig.placeholder ?? DEFAULT_PLACEHOLDER;
  const minResultChars = Math.max(0, options.minResultChars ?? timeConfig.minResultChars ?? DEFAULT_MIN_RESULT_CHARS);
  const tokenBudget = options.tokenBudget ?? timeConfig.tokenBudget;
  const grouped = groupMessages(messages as Message[]);
  const compactable = grouped.filter((group) => shouldCompactGroup(group, minResultChars));
  const selected = selectGroupsForCompaction(
    compactable,
    Math.max(0, tokenBudget ?? estimateMessagesTokens(messages as Message[])),
  );
  const clearable = selected.slice(0, Math.max(0, selected.length - keepLatest));
  const cacheEditToolUseIds = clearable.map((group) => group.toolUseId).filter((id): id is string => Boolean(id));

  if (clearable.length === 0) {
    return {
      messages: [...messages] as Message[],
      changed: false,
      clearedResults: 0,
      estimatedTokensSaved: 0,
      cacheEditToolUseIds,
      groupsCompacted: [],
    };
  }

  const before = estimateMessagesTokens(messages as Message[]);
  const clearableByGroup = new Map<string, MessageGroup>();
  for (const group of clearable) clearableByGroup.set(group.id, group);

  const nextMessages = (messages as Message[]).map((message) => {
    const toolUseId = messageToolUseId(message);
    if (!toolUseId) return message;
    const group = clearable.find((candidate) => candidate.toolUseId === toolUseId);
    if (!group) return message;
    return clearMessageContent(message, buildPlaceholder(group, placeholder));
  });

  const after = estimateMessagesTokens(nextMessages);
  return {
    messages: nextMessages,
    changed: true,
    clearedResults: clearable.length,
    estimatedTokensSaved: Math.max(0, before - after),
    cacheEditToolUseIds,
    groupsCompacted: clearable,
  };
}

export async function microcompactMessages(
  messages: readonly Message[],
  options: MicroCompactOptions = {},
): Promise<MicroCompactResult> {
  return performMicroCompact(messages, options);
}

export function estimateMicroCompactGroupTokens(group: MessageGroup): number {
  return getGroupTokenCount(group);
}
