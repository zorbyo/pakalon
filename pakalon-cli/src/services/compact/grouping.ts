import type { Message } from "@/types/message.js";
import { estimateMessageTokens, estimateMessagesTokens, normalizeContentToText } from "./tokenEstimation.js";

export interface GroupableMessage extends Message {
  toolUseId?: string;
  toolName?: string;
  topic?: string;
  parentMessageId?: string;
}

export interface MessageGroup {
  id: string;
  strategy: "tool_use_id" | "turn" | "topic" | "system";
  messages: GroupableMessage[];
  tokenCount: number;
  createdAt: number;
  toolUseId?: string;
  topic?: string;
  turnIndex?: number;
}

function messageRole(message: GroupableMessage): string {
  return String((message as { type?: unknown }).type ?? "unknown");
}

function inferTopic(message: GroupableMessage): string | undefined {
  const text = normalizeContentToText((message as { content?: unknown }).content).toLowerCase();
  const match = text.match(/\b(api|auth|build|bug|config|database|frontend|backend|test|deploy|ui|token|memory|context|file|tool)\b/);
  return match?.[1];
}

function isSystemMessage(message: GroupableMessage): boolean {
  return messageRole(message) === "system";
}

function toolUseId(message: GroupableMessage): string | undefined {
  const value = message.toolUseId ?? (message as { tool_use_id?: unknown }).tool_use_id;
  return typeof value === "string" ? value : undefined;
}

export function groupMessages(messages: readonly GroupableMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let turnIndex = 0;

  for (const message of messages) {
    const id = toolUseId(message);
    const topic = message.topic ?? inferTopic(message);
    const createdAt = typeof message.timestamp === "number" ? message.timestamp : Date.now();

    if (isSystemMessage(message)) {
      groups.push({
        id: `${createdAt}:system`,
        strategy: "system",
        messages: [message],
        tokenCount: estimateMessageTokens(message),
        createdAt,
      });
      continue;
    }

    const last = groups[groups.length - 1];
    if (id) {
      const group = last?.toolUseId === id ? last : undefined;
      if (group) {
        group.messages.push(message);
        group.tokenCount += estimateMessageTokens(message);
        continue;
      }
      groups.push({
        id,
        strategy: "tool_use_id",
        messages: [message],
        tokenCount: estimateMessageTokens(message),
        createdAt,
        toolUseId: id,
        topic,
      });
      continue;
    }

    const turnGroup = last?.strategy === "turn" ? last : undefined;
    if (turnGroup) {
      turnGroup.messages.push(message);
      turnGroup.tokenCount += estimateMessageTokens(message);
      continue;
    }

    groups.push({
      id: `turn-${turnIndex++}`,
      strategy: topic ? "topic" : "turn",
      messages: [message],
      tokenCount: estimateMessageTokens(message),
      createdAt,
      topic,
      turnIndex,
    });
  }

  return groups;
}

export function getGroupTokenCount(group: MessageGroup): number {
  return group.tokenCount || estimateMessagesTokens(group.messages);
}

export function selectGroupsForCompaction(groups: readonly MessageGroup[], budget: number): MessageGroup[] {
  if (budget <= 0 || groups.length === 0) return [];
  const sorted = [...groups].sort((a, b) => getGroupTokenCount(b) - getGroupTokenCount(a) || a.createdAt - b.createdAt);
  const selected: MessageGroup[] = [];
  let remaining = budget;
  for (const group of sorted) {
    const tokens = getGroupTokenCount(group);
    if (tokens > remaining && selected.length > 0) continue;
    selected.push(group);
    remaining -= tokens;
    if (remaining <= 0) break;
  }
  return selected.sort((a, b) => a.createdAt - b.createdAt);
}
