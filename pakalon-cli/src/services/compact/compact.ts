import type { Message } from "@/types/message.js";
import type { ToolUseContext, CompactProgressEvent } from "@/tools/tool-types.js";
import { estimateMessagesTokens, estimateMessageTokens, estimateTextTokens } from "./tokenEstimation.js";
import { groupMessages, selectGroupsForCompaction, type MessageGroup } from "./grouping.js";
import { generateCompactPrompt, formatCompactSummary } from "./prompt.js";
import { microcompactMessages, type MicroCompactResult, type MicroCompactOptions } from "./microCompact.js";

export type { CompactProgressEvent } from "@/tools/tool-types.js";

export interface CompactionResult {
  boundaryMarker: SystemCompactBoundaryMessage;
  summaryMessages: Message[];
  attachments: Message[];
  hookResults: Message[];
  messagesToKeep?: Message[];
  userDisplayMessage?: string;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
  truePostCompactTokenCount?: number;
  tokensSaved?: number;
  compactedGroups?: MessageGroup[];
}

export type CompactEvent =
  | { type: "sessionStart"; sessionId?: string; messageCount: number; timestamp: number }
  | { type: "preCompactStart"; reason: string; messageCount: number; timestamp: number }
  | { type: "postCompactComplete"; success: boolean; tokensSaved: number; timestamp: number };

export interface CompactHookContext {
  phase: "pre" | "post" | "session_start";
  messages: Message[];
  options: CompactOptions;
  summaryText?: string;
  boundaryMessage?: SystemCompactBoundaryMessage;
  microcompactResult?: MicroCompactResult;
}

export type CompactHook =
  (ctx: CompactHookContext) =>
    | void
    | Promise<void>
    | Partial<Pick<CompactionResult, "summaryMessages" | "hookResults" | "messagesToKeep" | "userDisplayMessage">>;

export interface CompactOptions {
  reason?: string;
  focusHint?: string;
  sessionId?: string;
  maxTokens?: number;
  keepLatestMessages?: number;
  keepLatestToolResults?: number;
  tokenRatio?: number;
  signal?: AbortSignal;
  progressCallback?: (event: CompactProgressEvent) => void;
  onEvent?: (event: CompactEvent) => void;
  preCompactHooks?: CompactHook[];
  postCompactHooks?: CompactHook[];
  microCompactOptions?: MicroCompactOptions;
}

export interface SystemCompactBoundaryMessage extends Message {
  type: "system";
  subtype: "compact_boundary";
  content: string;
  compactedAt: number;
  compactReason?: string;
  compactedMessageCount?: number;
}

export interface CompactHookResult {
  summaryMessages?: Message[];
  hookResults?: Message[];
  messagesToKeep?: Message[];
  userDisplayMessage?: string;
}

export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  "Compaction interrupted — please try again.";
export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  "Not enough messages to compact.";
export const ERROR_MESSAGE_USER_ABORT = "Compaction cancelled by user.";

export function mergeHookInstructions(systemPrompt: string, hooks?: Array<{ content?: string } | string>): string {
  if (!hooks?.length) return systemPrompt;
  const rendered = hooks
    .map((hook) => (typeof hook === "string" ? hook : hook.content ?? ""))
    .filter(Boolean)
    .join("\n\n");
  return rendered ? `${systemPrompt}\n\n${rendered}` : systemPrompt;
}

export async function executePreCompactHooks(
  ctx: CompactHookContext,
  hooks: CompactHook[] = [],
): Promise<CompactHookResult> {
  const result: CompactHookResult = {};
  for (const hook of hooks) {
    const value = await hook(ctx);
    if (!value) continue;
    if (value.summaryMessages) result.summaryMessages = [...(result.summaryMessages ?? []), ...value.summaryMessages];
    if (value.hookResults) result.hookResults = [...(result.hookResults ?? []), ...value.hookResults];
    if (value.messagesToKeep) result.messagesToKeep = [...(result.messagesToKeep ?? []), ...value.messagesToKeep];
    if (value.userDisplayMessage) {
      result.userDisplayMessage = result.userDisplayMessage
        ? `${result.userDisplayMessage}\n${value.userDisplayMessage}`
        : value.userDisplayMessage;
    }
  }
  return result;
}

export async function executePostCompactHooks(
  ctx: CompactHookContext,
  hooks: CompactHook[] = [],
): Promise<CompactHookResult> {
  const result: CompactHookResult = {};
  for (const hook of hooks) {
    const value = await hook(ctx);
    if (!value) continue;
    if (value.summaryMessages) result.summaryMessages = [...(result.summaryMessages ?? []), ...value.summaryMessages];
    if (value.hookResults) result.hookResults = [...(result.hookResults ?? []), ...value.hookResults];
    if (value.messagesToKeep) result.messagesToKeep = [...(result.messagesToKeep ?? []), ...value.messagesToKeep];
    if (value.userDisplayMessage) {
      result.userDisplayMessage = result.userDisplayMessage
        ? `${result.userDisplayMessage}\n${value.userDisplayMessage}`
        : value.userDisplayMessage;
    }
  }
  return result;
}

export function buildSystemCompactBoundaryMessage(
  messages: Message[],
  reason: string,
  summaryText: string,
): SystemCompactBoundaryMessage {
  return {
    type: "system",
    subtype: "compact_boundary",
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    compactedAt: Date.now(),
    compactReason: reason,
    compactedMessageCount: messages.length,
    content: `[Context Compact Boundary]\nReason: ${reason}\nMessages: ${messages.length}\n${summaryText}`,
  };
}

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({
    ...message,
    timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
  }));
}

function keepTailMessages(messages: Message[], keepLatestMessages: number): Message[] {
  const tail = Math.max(0, keepLatestMessages);
  return tail > 0 ? messages.slice(-tail) : [];
}

function summarizeGroups(groups: MessageGroup[], reason: string, focusHint?: string): string {
  const lines = groups.flatMap((group) => [
    `- ${group.strategy}: ${group.messages.length} message(s), ~${group.tokenCount} tokens${group.topic ? `, topic: ${group.topic}` : ""}`,
  ]);
  return generateCompactPrompt({
    reason,
    tokensSaved: 0,
    messageCount: { before: groups.reduce((sum, group) => sum + group.messages.length, 0), after: 0 },
    toolResultsCompacted: groups.filter((group) => group.strategy === "tool_use_id").length,
    contentReplaced: groups.reduce((sum, group) => sum + group.messages.length, 0),
    focusHint,
    notes: lines,
  });
}

export async function executeCompact(
  messages: Message[],
  options: CompactOptions = {},
): Promise<CompactionResult> {
  const normalized = normalizeMessages(messages);
  const reason = options.reason ?? options.focusHint ?? "manual compact";
  const beforeTokens = estimateMessagesTokens(normalized, { charTokensRatio: options.tokenRatio });
  const groups = groupMessages(normalized);
  const selectedGroups = selectGroupsForCompaction(groups, Math.max(0, (options.maxTokens ?? beforeTokens) - 1_000));
  const tail = keepTailMessages(normalized, options.keepLatestMessages ?? 8);
  const compactedGroups = selectedGroups.length ? selectedGroups : groups.slice(0, Math.max(0, groups.length - tail.length));
  const summaryText = summarizeGroups(compactedGroups, reason, options.focusHint);
  const boundaryMarker = buildSystemCompactBoundaryMessage(normalized, reason, summaryText);
  const summaryMessage: Message = {
    type: "assistant",
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    content: formatCompactSummary({
      reason,
      messageCount: { before: normalized.length, after: tail.length + 2 },
      tokensSaved: 0,
      toolResultsCompacted: compactedGroups.filter((group) => group.strategy === "tool_use_id").length,
      contentReplaced: compactedGroups.reduce((sum, group) => sum + group.messages.length, 0),
    }),
  };

  const attachments = normalized.filter((message) => message.type === "attachment");
  const hookResults: Message[] = [];

  const compacted = [boundaryMarker, summaryMessage, ...tail];
  const afterTokens = estimateMessagesTokens(compacted, { charTokensRatio: options.tokenRatio });
  const tokensSaved = Math.max(0, beforeTokens - afterTokens);

  if (options.progressCallback) {
    options.progressCallback({ type: "hooks_start", hookType: "pre_compact" });
    options.progressCallback({ type: "compact_start" });
    options.progressCallback({ type: "compact_end" });
  }

  if (options.onEvent) {
    options.onEvent({ type: "preCompactStart", reason, messageCount: normalized.length, timestamp: Date.now() });
    options.onEvent({ type: "postCompactComplete", success: true, tokensSaved, timestamp: Date.now() });
  }

  return {
    boundaryMarker,
    summaryMessages: [summaryMessage],
    attachments,
    hookResults,
    messagesToKeep: tail,
    userDisplayMessage: formatCompactSummary({
      reason,
      messageCount: { before: normalized.length, after: compacted.length },
      tokensSaved,
      toolResultsCompacted: compactedGroups.filter((group) => group.strategy === "tool_use_id").length,
      contentReplaced: compactedGroups.reduce((sum, group) => sum + group.messages.length, 0),
    }),
    preCompactTokenCount: beforeTokens,
    postCompactTokenCount: afterTokens,
    truePostCompactTokenCount: estimateMessagesTokens(compacted, { charTokensRatio: options.tokenRatio }),
    tokensSaved,
    compactedGroups,
  };
}

export async function compact(
  ctx: Pick<ToolUseContext, "onCompactProgress" | "abortController" | "setSDKStatus" | "setStreamMode" | "setResponseLength"> | null,
  messages: Message[],
  options: CompactOptions = {},
): Promise<CompactionResult> {
  if (ctx?.abortController.signal.aborted) {
    throw new Error(ERROR_MESSAGE_USER_ABORT);
  }

  const eventStart: CompactEvent = {
    type: "sessionStart",
    sessionId: options.sessionId,
    messageCount: messages.length,
    timestamp: Date.now(),
  };
  options.onEvent?.(eventStart);
  ctx?.onCompactProgress?.({ type: "hooks_start", hookType: "session_start" });

  const pre = await executePreCompactHooks(
    { phase: "pre", messages, options },
    options.preCompactHooks ?? [],
  );
  const micro = microcompactMessages(messages, {
    ...(options.microCompactOptions ?? {}),
    keepLatestToolResults: options.keepLatestToolResults ?? options.microCompactOptions?.keepLatestToolResults,
  });
  const compacted = await executeCompact(micro.messages, options);
  const post = await executePostCompactHooks(
    { phase: "post", messages: compacted.messagesToKeep ?? [], options, summaryText: compacted.userDisplayMessage, boundaryMessage: compacted.boundaryMarker },
    options.postCompactHooks ?? [],
  );

  return {
    ...compacted,
    summaryMessages: [...compacted.summaryMessages, ...(pre.summaryMessages ?? []), ...(post.summaryMessages ?? [])],
    hookResults: [...compacted.hookResults, ...(pre.hookResults ?? []), ...(post.hookResults ?? [])],
    messagesToKeep: post.messagesToKeep ?? compacted.messagesToKeep,
    userDisplayMessage: [pre.userDisplayMessage, compacted.userDisplayMessage, post.userDisplayMessage].filter(Boolean).join("\n") || compacted.userDisplayMessage,
  };
}

export async function compactConversation(
  messages: Message[],
  contextOrOptions?: ToolUseContext | CompactOptions | null,
  _cacheSharingParams?: unknown,
  _isAuto?: boolean,
  customInstructions?: string,
  _force?: boolean,
): Promise<CompactionResult> {
  const options: CompactOptions =
    contextOrOptions && typeof contextOrOptions === "object" && "onCompactProgress" in contextOrOptions
      ? {
          reason: customInstructions || undefined,
          sessionId: (contextOrOptions as ToolUseContext).agentId?.id,
          progressCallback: (contextOrOptions as ToolUseContext).onCompactProgress,
          onEvent: undefined,
        }
      : (contextOrOptions as CompactOptions | undefined) ?? {};

  return compact(null, messages, {
    ...options,
    reason: options.reason ?? customInstructions ?? options.focusHint ?? "manual compact",
  });
}

export function estimateTokenBudget(messages: Message[], ratio = 4): number {
  return estimateMessagesTokens(messages, { charTokensRatio: ratio });
}

export function estimateMessageTokensForCompact(message: Message, ratio = 4): number {
  return estimateMessageTokens(message, { charTokensRatio: ratio });
}

export function estimateTextTokensForCompact(text: string, ratio = 4): number {
  return estimateTextTokens(text, { charTokensRatio: ratio });
}
