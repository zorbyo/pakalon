/**
 * Session Title Generation
 * 
 * Generates concise, sentence-case session titles from conversation content.
 * Uses AI to create descriptive titles that help users identify sessions.
 */

import { z } from 'zod';
import logger from '../utils/logger.js';
import type { SessionMessage, SessionId } from './types.js';

const MAX_CONVERSATION_TEXT = 1000;

const SESSION_TITLE_PROMPT = `Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session. The title should be clear enough that the user recognizes the session in a list. Use sentence case: capitalize only the first word and proper nouns.

Return JSON with a single "title" field.

Good examples:
{"title": "Fix login button on mobile"}
{"title": "Add OAuth authentication"}
{"title": "Debug failing CI tests"}
{"title": "Refactor API client error handling"}

Bad (too vague): {"title": "Code changes"}
Bad (too long): {"title": "Investigate and fix the issue where the login button does not respond on mobile devices"}
Bad (wrong case): {"title": "Fix Login Button On Mobile"}`;

const titleSchema = z.object({
  title: z.string(),
});

/**
 * Flatten a message array into a single text string for title generation.
 * Skips meta/non-human messages. Tail-slices to the last 1000 chars so
 * recent context wins when the conversation is long.
 */
export function extractConversationTextFromTitle(messages: SessionMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (msg.metadata?.isMeta) continue;
    if (msg.metadata?.origin && msg.metadata.origin.kind !== 'human') continue;

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
 * Parse title from JSON response
 */
function parseTitleFromResponse(response: string): string | null {
  try {
    const jsonMatch = response.match(/\{[^}]*"title"[^}]*\}/);
    if (jsonMatch) {
      const parsed = titleSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (parsed.success) {
        return parsed.data.title.trim() || null;
      }
    }

    const titleMatch = response.match(/"title"\s*:\s*"([^"]+)"/);
    if (titleMatch) {
      return titleMatch[1]?.trim() || null;
    }
  } catch {
    // Fall through to null return
  }
  return null;
}

/**
 * Generate a session title from description or conversation
 * 
 * @param description - The user's first message or a description of the session
 * @param signal - Optional AbortSignal for cancellation
 * @returns Generated title or null on failure
 */
export async function generateSessionTitle(
  description: string,
  signal?: AbortSignal
): Promise<string | null> {
  const trimmed = description.trim();
  if (!trimmed) return null;

  try {
    const response = await queryHaiku({
      systemPrompt: SESSION_TITLE_PROMPT,
      userPrompt: trimmed,
      signal,
    });

    const title = parseTitleFromResponse(response);
    
    if (title) {
      logger.debug(`Generated session title: ${title}`);
    }

    return title;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('Session title generation aborted');
      return null;
    }
    logger.error('Failed to generate session title:', error);
    return null;
  }
}

/**
 * Generate title from conversation messages
 */
export async function generateTitleFromMessages(
  messages: SessionMessage[],
  signal?: AbortSignal
): Promise<string | null> {
  const text = extractConversationText(messages);
  
  if (!text) {
    return null;
  }

  return generateSessionTitle(text, signal);
}

/**
 * Query Haiku model for title generation
 */
async function queryHaiku(options: {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const { systemPrompt, userPrompt, signal } = options;

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.HAIKU_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  if (!apiKey) {
    logger.warn('No API key available for title generation');
    return generateFallbackTitle(userPrompt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'haiku',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 50,
      }),
      signal: signal ? signal : controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in response');
    }

    return content;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Generate a fallback title when AI generation fails
 */
function generateFallbackTitle(description: string): string {
  const firstLine = description.split('\n')[0] || description;
  const words = firstLine.split(/\s+/).slice(0, 5);
  const title = words.join(' ');

  if (title.length > 50) {
    return title.slice(0, 47) + '...';
  }

  return title || 'Untitled Session';
}

/**
 * Validate title format
 */
export function isValidTitle(title: string): boolean {
  if (!title || title.length < 1 || title.length > 100) {
    return false;
  }
  return true;
}

/**
 * Sanitize title for filesystem
 */
export function sanitizeTitle(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s\-_.,!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Extract title from first user message
 */
export function extractTitleFromFirstMessage(messages: SessionMessage[]): string | null {
  const firstUserMessage = messages.find((m) => m.role === 'user');

  if (!firstUserMessage) {
    return null;
  }

  const content = firstUserMessage.content;
  if (typeof content === 'string') {
    const firstLine = content.split('\n')[0];
    if (firstLine) {
      return sanitizeTitle(firstLine.slice(0, 60));
    }
  }

  return null;
}

export default {
  generateSessionTitle,
  generateTitleFromMessages,
  extractConversationText,
  isValidTitle,
  sanitizeTitle,
  extractTitleFromFirstMessage,
};