/**
 * Session Replay — allows users to replay a previous session's conversation.
 * 
 * Features:
 * - Replay all messages from a session
 * - Replay with speed control (fast/normal/slow)
 * - Replay specific message range
 * - Show replay progress
 */

import { getApiClient } from "@/api/client.js";
import { useStore } from "@/store/index.js";
import { isSelfHosted } from "@/config/mode.js";
import type { ChatMessage } from "@/store/slices/session.slice.js";
import { loadLocalSessionMessages } from "@/db/local.js";

export interface ReplayOptions {
  sessionId?: string;
  speed?: "fast" | "normal" | "slow";
  startIndex?: number;
  endIndex?: number;
  cwd?: string;
  onProgress?: (current: number, total: number) => void;
  onMessage?: (message: ChatMessage, index: number) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  abortSignal?: AbortSignal;
}

export interface ReplayResult {
  success: boolean;
  sessionId: string;
  messagesReplayed: number;
  duration: number;
}

const SPEED_DELAYS = {
  fast: 100,
  normal: 500,
  slow: 1500,
};

export async function replaySession(options: ReplayOptions): Promise<ReplayResult> {
  const {
    speed = "normal",
    startIndex = 0,
    endIndex,
    onProgress,
    onMessage,
    onComplete,
    onError,
    abortSignal,
  } = options;

  const startTime = Date.now();
  const delayMs = SPEED_DELAYS[speed];
  
  try {
    const messages = await loadSessionMessages(options.sessionId, options.cwd);
    
    if (abortSignal?.aborted) {
      throw new Error("Replay aborted");
    }

    const endIdx = endIndex ?? messages.length;
    const relevantMessages = messages.slice(startIndex, endIdx);
    
    let replayed = 0;
    for (let i = 0; i < relevantMessages.length; i++) {
      if (abortSignal?.aborted) {
        throw new Error("Replay aborted");
      }

      const msg = relevantMessages[i]!;
      onMessage?.(msg, startIndex + i);
      onProgress?.(replayed + 1, relevantMessages.length);
      
      replayed++;
      
      if (i < relevantMessages.length - 1) {
        await sleep(delayMs);
      }
    }

    const duration = Date.now() - startTime;
    onComplete?.();

    return {
      success: true,
      sessionId: options.sessionId ?? useStore.getState().sessionId ?? "unknown",
      messagesReplayed: replayed,
      duration,
    };
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      sessionId: options.sessionId ?? "unknown",
      messagesReplayed: 0,
      duration: Date.now() - startTime,
    };
  }
}

async function loadSessionMessages(sessionId?: string, cwd?: string): Promise<ChatMessage[]> {
  const targetId = sessionId ?? useStore.getState().sessionId;
  
  if (!targetId) {
    throw new Error("No session ID provided and no active session");
  }

  if (isSelfHosted()) {
    const localMessages = loadLocalSessionMessages(targetId);
    return localMessages.map(m => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system" | "tool",
      content: m.content,
      createdAt: new Date(m.created_at),
      isStreaming: false,
    }));
  }

  const client = getApiClient();
  const res = await client.get<{ messages: Array<{ id: string; role: string; content: string; created_at: string }> }>(
    `/sessions/${targetId}/messages`
  );
  
  return (res.data.messages ?? []).map(m => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system" | "tool",
    content: m.content,
    createdAt: new Date(m.created_at),
    isStreaming: false,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatReplayProgress(current: number, total: number): string {
  const pct = Math.round((current / total) * 100);
  const barLen = 20;
  const filled = Math.round((current / total) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
  return `[${bar}] ${current}/${total} (${pct}%)`;
}

export function parseReplaySpeed(speedArg?: string): "fast" | "normal" | "slow" {
  switch (speedArg?.toLowerCase()) {
    case "fast":
    case "f":
    case "1":
      return "fast";
    case "slow":
    case "s":
    case "0.5":
      return "slow";
    default:
      return "normal";
  }
}