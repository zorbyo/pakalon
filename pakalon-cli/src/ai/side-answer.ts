import type { ModelMessage as CoreMessage } from "ai";

import { generateCompletion } from "@/ai/openrouter.js";
import type { ModelEffortConfig, PrivacyLevel } from "@/store/slices/mode.slice.js";

const SIDE_ANSWER_SYSTEM = `You are answering a side-thread question while Pakalon may be busy with another task.

Rules:
- Answer only the side-thread question.
- Do not call tools, modify files, or ask the main agent to stop.
- Use the supplied recent conversation context only when it is directly relevant.
- Be concise and explicit about uncertainty.`;

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeRecentMessages(messages: CoreMessage[], maxMessages: number): CoreMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-maxMessages)
    .map((message) => ({
      role: message.role,
      content: contentToText(message.content).slice(0, 4000),
    }))
    .filter((message) => message.content.trim().length > 0);
}

export interface GenerateSideAnswerOptions {
  question: string;
  messages: CoreMessage[];
  model: string;
  apiKey?: string;
  authToken?: string;
  useProxy?: boolean;
  proxyBaseUrl?: string;
  privacyLevel?: PrivacyLevel;
  thinkingEnabled?: boolean;
  modelEffortConfig?: ModelEffortConfig | null;
  maxContextMessages?: number;
}

export async function generateSideAnswer(
  options: GenerateSideAnswerOptions,
): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
  const question = options.question.trim();
  if (!question) {
    throw new Error("Side-thread question is empty.");
  }

  const recentMessages = normalizeRecentMessages(options.messages, options.maxContextMessages ?? 16);
  const messages: CoreMessage[] = [
    ...recentMessages,
    {
      role: "user",
      content: `Side-thread question:\n${question}`,
    },
  ];

  return generateCompletion({
    model: options.model,
    messages,
    system: SIDE_ANSWER_SYSTEM,
    maxTokens: 1200,
    temperature: 0.2,
    apiKey: options.apiKey,
    authToken: options.authToken,
    useProxy: options.useProxy,
    proxyBaseUrl: options.proxyBaseUrl,
    privacyLevel: options.privacyLevel,
    thinkingEnabled: options.thinkingEnabled,
    modelEffortConfig: options.modelEffortConfig,
  });
}
