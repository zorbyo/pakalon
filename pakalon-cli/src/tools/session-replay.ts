/**
 * Session Replay - Replay past user messages for debugging/continuity
 * 
 * Allows replaying user messages from previous sessions to continue
 * a conversation or debug issues.
 */

import { tool } from "ai";
import { z } from "zod";
import { cmdListSessions, cmdResumeSession } from "@/commands/session.js";
import { useStore } from "@/store/index.js";
import logger from "@/utils/logger.js";

export interface ReplayOptions {
  sessionId?: string;
  messageIndices?: number[];
  reverse?: boolean;
  speed?: number;
}

export interface ReplayResult {
  success: boolean;
  replayedMessages: Array<{
    index: number;
    content: string;
    timestamp: Date;
  }>;
  error?: string;
}

export const sessionReplayTool = tool({
  description: "Replay user messages from a previous session",
  parameters: z.object({
    action: z.enum(["list", "replay", "info"]).describe("Action to perform"),
    sessionId: z.string().optional().describe("Session ID to replay from"),
    messageIndices: z.array(z.number()).optional().describe("Specific message indices to replay"),
    reverse: z.boolean().optional().describe("Replay in reverse order"),
    speed: z.number().optional().describe("Replay speed multiplier"),
  }),
});

export async function listReplayableSessions(): Promise<{
  sessions: Array<{
    id: string;
    createdAt: Date;
    messageCount: number;
  }>;
  error?: string;
}> {
  try {
    const sessions = await cmdListSessions(20);
    return {
      sessions: sessions.map((s: any) => ({
        id: s.id,
        createdAt: new Date(s.created_at),
        messageCount: s.messages_count || s.message_count || 0,
      })),
    };
  } catch (err) {
    return { sessions: [], error: String(err) };
  }
}

export async function getSessionReplayInfo(sessionId: string): Promise<{
  messages: Array<{
    index: number;
    role: string;
    content: string;
    timestamp: Date;
  }>;
  error?: string;
}> {
  try {
    const session = await cmdResumeSession(sessionId);
    return {
      messages: session.messages?.map((m: any, i: number) => ({
        index: i,
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        timestamp: new Date(m.created_at || Date.now()),
      })) || [],
    };
  } catch (err) {
    return { messages: [], error: String(err) };
  }
}

export async function replaySessionMessages(
  sessionId: string,
  options: {
    messageIndices?: number[];
    reverse?: boolean;
    addToCurrentSession?: boolean;
  } = {}
): Promise<ReplayResult> {
  try {
    const info = await getSessionReplayInfo(sessionId);
    if (info.error) {
      return { success: false, replayedMessages: [], error: info.error };
    }

    let messages = info.messages.filter((m) => m.role === "user");

    if (options.messageIndices && options.messageIndices.length > 0) {
      messages = messages.filter((_, i) => options.messageIndices!.includes(i));
    }

    if (options.reverse) {
      messages = messages.reverse();
    }

    if (options.addToCurrentSession) {
      for (const msg of messages) {
        useStore.getState().addMessage({
          id: `replay-${Date.now()}-${msg.index}`,
          role: "user",
          content: msg.content,
          createdAt: msg.timestamp,
        });
      }
    }

    return {
      success: true,
      replayedMessages: messages,
    };
  } catch (err) {
    return { success: false, replayedMessages: [], error: String(err) };
  }
}