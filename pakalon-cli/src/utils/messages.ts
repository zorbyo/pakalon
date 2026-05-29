/**
 * Message helpers used by advanced tool orchestration.
 */

export type CreateUserMessageInput = {
  content: unknown;
  toolUseResult?: string;
  sourceToolAssistantUUID?: string;
};

export function withMemoryCorrectionHint(message: string): string {
  return `${message}\n\nIf this result affects your plan, update your working memory before continuing.`;
}

export function createUserMessage(input: CreateUserMessageInput): {
  type: "user";
  uuid: string;
  timestamp: number;
  message: {
    role: "user";
    content: unknown;
  };
  toolUseResult?: string;
  sourceToolAssistantUUID?: string;
} {
  return {
    type: "user",
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    message: {
      role: "user",
      content: input.content,
    },
    ...(input.toolUseResult ? { toolUseResult: input.toolUseResult } : {}),
    ...(input.sourceToolAssistantUUID ? { sourceToolAssistantUUID: input.sourceToolAssistantUUID } : {}),
  };
}

export function createAwaySummaryMessage(summary: string): {
  type: "system";
  uuid: string;
  timestamp: number;
  subtype: "away_summary";
  content: string;
} {
  return {
    type: "system",
    uuid: crypto.randomUUID(),
    timestamp: Date.now(),
    subtype: "away_summary",
    content: summary,
  };
}
