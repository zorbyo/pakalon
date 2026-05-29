import type { CoreMessage } from "ai";
import { estimateMessagesTokens } from "@/ai/context.js";

export interface MessageGroup {
  startIndex: number;
  endIndex: number;
  messages: CoreMessage[];
  estimatedTokens: number;
}

export interface SnipCompactOptions {
  maxTokens: number;
  keepLatestGroups?: number;
  boundaryText?: string;
}

export interface SnipCompactResult {
  messages: CoreMessage[];
  changed: boolean;
  removedGroups: number;
  removedMessages: number;
  estimatedTokensSaved: number;
}

const DEFAULT_KEEP_LATEST_GROUPS = 4;
const DEFAULT_BOUNDARY_TEXT = "[earlier conversation truncated for length]";

function roleOf(message: CoreMessage): string {
  return String((message as { role?: unknown }).role ?? "");
}

function isSystemMessage(message: CoreMessage): boolean {
  return roleOf(message) === "system";
}

export function groupMessagesByApiRound(messages: readonly CoreMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: CoreMessage[] = [];
  let startIndex = 0;

  const flush = (endIndex: number) => {
    if (current.length === 0) return;
    groups.push({
      startIndex,
      endIndex,
      messages: current,
      estimatedTokens: estimateMessagesTokens(current),
    });
    current = [];
  };

  messages.forEach((message, index) => {
    const role = roleOf(message);
    const startsNewRound = role === "user" && current.length > 0;
    if (startsNewRound) {
      flush(index - 1);
      startIndex = index;
    }
    if (current.length === 0) startIndex = index;
    current.push(message);
  });

  flush(messages.length - 1);
  return groups;
}

function createBoundaryMessage(text: string): CoreMessage {
  return {
    role: "system",
    content: text,
  } as CoreMessage;
}

export function snipCompactIfNeeded(
  messages: readonly CoreMessage[],
  options: SnipCompactOptions,
): SnipCompactResult {
  const maxTokens = Math.max(1, options.maxTokens);
  const currentTokens = estimateMessagesTokens([...messages]);
  if (currentTokens <= maxTokens) {
    return {
      messages: [...messages],
      changed: false,
      removedGroups: 0,
      removedMessages: 0,
      estimatedTokensSaved: 0,
    };
  }

  const systemMessages = messages.filter(isSystemMessage);
  const nonSystem = messages.filter((message) => !isSystemMessage(message));
  const groups = groupMessagesByApiRound(nonSystem);
  const keepLatestGroups = Math.max(1, options.keepLatestGroups ?? DEFAULT_KEEP_LATEST_GROUPS);

  let firstKeptGroupIndex = Math.max(0, groups.length - keepLatestGroups);
  let keptGroups = groups.slice(firstKeptGroupIndex);
  let candidate = [
    ...systemMessages,
    createBoundaryMessage(options.boundaryText ?? DEFAULT_BOUNDARY_TEXT),
    ...keptGroups.flatMap((group) => group.messages),
  ];

  while (estimateMessagesTokens(candidate) > maxTokens && firstKeptGroupIndex < groups.length - 1) {
    firstKeptGroupIndex += 1;
    keptGroups = groups.slice(firstKeptGroupIndex);
    candidate = [
      ...systemMessages,
      createBoundaryMessage(options.boundaryText ?? DEFAULT_BOUNDARY_TEXT),
      ...keptGroups.flatMap((group) => group.messages),
    ];
  }

  const removedGroups = firstKeptGroupIndex;
  const removedMessages = groups
    .slice(0, firstKeptGroupIndex)
    .reduce((sum, group) => sum + group.messages.length, 0);
  const newTokens = estimateMessagesTokens(candidate);

  return {
    messages: candidate,
    changed: removedGroups > 0,
    removedGroups,
    removedMessages,
    estimatedTokensSaved: Math.max(0, currentTokens - newTokens),
  };
}
