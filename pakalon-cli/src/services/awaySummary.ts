import type { ModelMessage } from "ai";
import { generateCompletion } from "../ai/openrouter.js";
import type { Message } from "../types/message.js";

const AWAY_SUMMARY_SYSTEM_PROMPT = `You are a helpful assistant summarizing what happened in a coding session while the user was away.
Provide a concise, clear summary of the key changes, decisions, and outcomes.
Focus on what was accomplished, what files were modified, and any important context for continuing work.
Keep it brief — 3-5 sentences maximum.`;

function messagesToCoreMessages(messages: readonly Message[]): ModelMessage[] {
  const coreMessages: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.type === "user" && msg.message) {
      coreMessages.push(msg.message as ModelMessage);
    } else if (msg.type === "assistant" && msg.message) {
      coreMessages.push(msg.message as ModelMessage);
    }
  }

  return coreMessages;
}

export async function generateAwaySummary(
  messages: readonly Message[],
  signal: AbortSignal,
): Promise<string | null> {
  const recentMessages = messages.slice(-20);
  const coreMessages = messagesToCoreMessages(recentMessages);

  if (coreMessages.length === 0) {
    return null;
  }

  try {
    const result = await generateCompletion({
      model: process.env.AWAY_SUMMARY_MODEL ?? "anthropic/claude-sonnet-4-20250514",
      messages: coreMessages,
      system: AWAY_SUMMARY_SYSTEM_PROMPT,
      maxTokens: 500,
      temperature: 0.3,
    });

    if (signal.aborted) {
      return null;
    }

    return result.text?.trim() || null;
  } catch {
    return null;
  }
}
