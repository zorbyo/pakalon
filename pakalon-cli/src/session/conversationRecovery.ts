/**
 * Conversation Recovery - Session resume after interruption
 * 
 * Handles recovering conversations after interruption including:
 * - Loading and deserializing messages from disk
 * - Detecting turn interruption state
 * - Restoring skill state and attachments
 * - Processing session start hooks
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';
import type {
  SessionResumeData,
  TurnInterruptionState,
  SessionMetadata,
  PersistedWorktreeSession,
  ContentReplacementRecord,
  SessionMessage,
} from './types.js';
import { sessionStorage, getProjectDir, getTranscriptPath } from './sessionStorage.js';

const MAX_CONVERSATION_TEXT = 1000;

/**
 * Helper to find last index with compatible syntax
 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i]!)) {
      return i;
    }
  }
  return -1;
}

/**
 * Detect if conversation was interrupted mid-turn
 */
export function detectTurnInterruption(
  messages: SessionMessage[]
): 'none' | 'interrupted_prompt' | 'interrupted_turn' {
  if (messages.length === 0) {
    return 'none';
  }

  const lastRelevantIdx = findLastIndex(
    messages,
    (m) => m.role !== 'system' && m.role !== 'tool'
  );

  if (lastRelevantIdx === -1) {
    return 'none';
  }

  const lastMessage = messages[lastRelevantIdx];

  if (lastMessage.role === 'assistant') {
    return 'none';
  }

  if (lastMessage.role === 'user') {
    const content = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : JSON.stringify(lastMessage.content);
    
    if (content.includes('isMeta') || content.includes('Continue from where you left off')) {
      return 'none';
    }

    return 'interrupted_prompt';
  }

  if (lastMessage.role === 'tool') {
    return 'interrupted_turn';
  }

  return 'none';
}

/**
 * Deserialize messages from disk for resume
 * Filters unresolved tool uses, orphaned thinking messages
 */
export function deserializeMessages(serializedMessages: SessionMessage[]): SessionMessage[] {
  const filtered: SessionMessage[] = [];

  for (let i = 0; i < serializedMessages.length; i++) {
    const msg = serializedMessages[i]!;

    if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string' && content.trim() === '') {
        continue;
      }
      if (Array.isArray(content) && content.length === 0) {
        continue;
      }
    }

    if (msg.role === 'tool') {
      const toolResult = msg.content;
      if (typeof toolResult === 'string' && toolResult.includes('unresolved')) {
        continue;
      }
    }

    filtered.push(msg);
  }

  return filtered;
}

/**
 * Create a continuation message for interrupted turns
 */
function createContinuationMessage(): SessionMessage {
  return {
    role: 'user',
    content: 'Continue from where you left off.',
    metadata: { isMeta: true },
  };
}

/**
 * Append synthetic assistant sentinel after last user message
 */
function appendSentinel(messages: SessionMessage[]): SessionMessage[] {
  const lastRelevantIdx = findLastIndex(
    messages,
    (m) => m.role !== 'system' && m.role !== 'tool'
  );

  if (lastRelevantIdx !== -1 && messages[lastRelevantIdx]?.role === 'user') {
    const sentinel: SessionMessage = {
      role: 'assistant',
      content: 'Understood. Continuing from where we left off.',
    };
    return [...messages.slice(0, lastRelevantIdx + 1), sentinel, ...messages.slice(lastRelevantIdx + 1)];
  }

  return messages;
}

/**
 * Load and deserialize messages from a transcript file
*/
export async function loadMessagesFromTranscript(
  sessionId: string,
  projectDir?: string
): Promise<SessionMessage[]> {
  const transcriptPath = getTranscriptPath(sessionId, projectDir);

  if (!fsSync.existsSync(transcriptPath)) {
    logger.warn(`Transcript not found: ${transcriptPath}`);
    return [];
  }

  try {
    const content = await fs.readFile(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());

    const messages: SessionMessage[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        if (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system') {
          const msg: SessionMessage = {
            role: entry.type === 'user' ? 'user' : entry.type === 'assistant' ? 'assistant' : 'system',
            content: entry.message?.content || entry.content || '',
            metadata: {
              uuid: entry.uuid,
              parentUuid: entry.parentUuid,
              timestamp: entry.timestamp,
              sessionId: entry.sessionId,
            },
          };

          if (entry.message?.content) {
            msg.content = entry.message.content;
          } else if (entry.content) {
            msg.content = entry.content;
          }

          messages.push(msg);
        }
      } catch (err) {
        logger.debug(`Failed to parse line: ${err}`);
      }
    }

    return messages;
  } catch (err) {
    logger.error(`Failed to load transcript: ${err}`);
    return [];
  }
}

/**
 * Extract text content from messages for title generation
 */
export function extractConversationText(messages: SessionMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (msg.metadata?.isMeta) continue;

    const content = msg.content;
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          parts.push(block.text as string);
        }
      }
    }
  }

  const text = parts.join('\n');
  return text.length > MAX_CONVERSATION_TEXT
    ? text.slice(-MAX_CONVERSATION_TEXT)
    : text;
}

/**
 * Restore skill state from invoked_skills attachments in messages
 */
export function restoreSkillStateFromMessages(messages: SessionMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'system') continue;

    const content = message.content;
    if (typeof content !== 'string') continue;

    if (content.includes('invoked_skills')) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.attachment?.type === 'invoked_skills') {
          // Skill restoration would happen here
          logger.debug('Restored skill state from messages');
        }
      } catch {
        // Not JSON, skip
      }
    }
  }
}

/**
 * Load conversation for resume
 */
export async function loadConversationForResume(
  sessionId?: string
): Promise<SessionResumeData | null> {
  try {
    let targetSessionId = sessionId;
    let sessionData: { metadata: SessionMetadata; messages: SessionMessage[]; state?: Record<string, unknown> } | null = null;

    if (!targetSessionId) {
      const sessions = await sessionStorage.listSessions({ archived: false, limit: 1 });
      if (sessions.length === 0) {
        return null;
      }
      targetSessionId = sessions[0]!.id;
    }

    const loaded = await sessionStorage.loadSession(targetSessionId);
    if (!loaded) {
      return null;
    }

    sessionData = loaded;
    const messages = await loadMessagesFromTranscript(targetSessionId);

    const deserialized = deserializeMessages(messages);
    const turnInterruptionState = detectTurnInterruption(deserialized);

    let finalMessages = deserialized;

    if (turnInterruptionState === 'interrupted_turn') {
      finalMessages = [...deserialized, createContinuationMessage()];
    }

    finalMessages = appendSentinel(finalMessages);

    restoreSkillStateFromMessages(finalMessages);

    return {
      sessionId: targetSessionId,
      messages: finalMessages,
      state: sessionData.state || {},
      metadata: sessionData.metadata,
      turnInterruptionState,
    };
  } catch (error) {
    logger.error('Failed to load conversation for resume:', error);
    return null;
  }
}

/**
 * Check resume consistency
 */
export function checkResumeConsistency(messages: SessionMessage[]): void {
  let hasOrphanedToolResult = false;

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'tool') {
      const prevMsg = messages[i - 1];
      if (prevMsg?.role !== 'assistant') {
        hasOrphanedToolResult = true;
        break;
      }

      const assistantContent = prevMsg.content;
      let hasMatchingToolCall = false;

      if (typeof assistantContent === 'string') {
        hasMatchingToolCall = assistantContent.includes('tool_call');
      } else if (Array.isArray(assistantContent)) {
        hasMatchingToolCall = assistantContent.some(
          (block) => block.type === 'tool-call'
        );
      }

      if (!hasMatchingToolCall) {
        hasOrphanedToolResult = true;
        break;
      }
    }
  }

  if (hasOrphanedToolResult) {
    logger.warn('Resume consistency: found orphaned tool results');
  }
}

/**
 * Create resume data from a session
 */
export async function createResumeData(
  sessionId: string
): Promise<SessionResumeData | null> {
  return loadConversationForResume(sessionId);
}

/**
 * List recent sessions for resume
 */
export async function listRecentSessions(limit = 10): Promise<SessionMetadata[]> {
  return sessionStorage.listSessions({ archived: false, limit });
}

/**
 * Search sessions by title or tag
 */
export async function searchSessions(
  query: string,
  limit = 20
): Promise<SessionMetadata[]> {
  const sessions = await sessionStorage.listSessions({ archived: false, limit: 100 });
  const lowerQuery = query.toLowerCase();

  return sessions
    .filter(
      (s) =>
        s.title?.toLowerCase().includes(lowerQuery) ||
        s.tags?.some((t) => t.toLowerCase().includes(lowerQuery))
    )
    .slice(0, limit);
}

export default {
  loadConversationForResume,
  createResumeData,
  listRecentSessions,
  searchSessions,
  detectTurnInterruption,
  deserializeMessages,
  extractConversationText,
  checkResumeConsistency,
};