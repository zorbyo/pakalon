/**
 * Memory Extraction from Conversation
 * 
 * Automatically extracts useful memories from conversation messages
 * to persist across sessions. Matches Claude's memory extraction system.
 */

import type { CoreMessage } from "ai";
import { storeMemory } from "./store.js";
import logger from "@/utils/logger.js";

export interface MemoryExtractionRule {
  type: "user" | "feedback" | "project" | "preference" | "context";
  pattern: RegExp;
  extract: (match: RegExpMatchArray, message: CoreMessage) => string | null;
  description: string;
}

const MEMORY_TYPE_PATTERNS: MemoryExtractionRule[] = [
  // User role/preferences
  {
    type: "user",
    pattern: /(?:I am|a) (?:a |an )?([^.!?\n]+?)(?:\.|!|\?|$)/i,
    extract: (match) => {
      const role = match[1]?.trim();
      if (role && role.length > 3 && role.length < 100) {
        return `User role: ${role}`;
      }
      return null;
    },
    description: "Extract user role information",
  },
  // Explicit remember requests
  {
    type: "context",
    pattern: /(?:remember|keep in mind|note that|don't forget)[^.!?\n]+([^.!?]+)/gi,
    extract: (match) => match[1]?.trim() || null,
    description: "Extract explicit memory requests",
  },
  // Feedback patterns
  {
    type: "feedback",
    pattern: /(?:don't|do not|stop|avoid|never)[^.!?\n]+([^.!?]+)/gi,
    extract: (match) => `Avoid: ${match[1]?.trim()}`,
    description: "Extract user feedback/avoidances",
  },
  // Preference patterns
  {
    type: "preference",
    pattern: /(?:I prefer|I like|I hate|I always|I never)[^.!?\n]+([^.!?]+)/gi,
    extract: (match) => match[1]?.trim() || null,
    description: "Extract user preferences",
  },
  // Project context
  {
    type: "project",
    pattern: /(?:we're working on|building|creating|implementing|working on)[^.!?\n]+([^.!?]+)/gi,
    extract: (match) => `Project context: ${match[1]?.trim()}`,
    description: "Extract project context",
  },
];

export interface ExtractionResult {
  memoryId: string;
  type: string;
  text: string;
  sourceMessage: string;
}

export interface ExtractMemoriesOptions {
  userId: string;
  sessionId?: string;
  minConfidence?: number;
  maxMemories?: number;
}

/**
 * Extract memories from a list of messages
 */
export function extractMemoriesFromMessages(
  messages: CoreMessage[],
  options: ExtractMemoriesOptions
): ExtractionResult[] {
  const results: ExtractionResult[] = [];
  const seenTexts = new Set<string>();

  for (const message of messages) {
    const content = typeof message.content === "string" 
      ? message.content 
      : JSON.stringify(message.content);

    if (!content || content.length < 10) continue;

    for (const rule of MEMORY_TYPE_PATTERNS) {
      const matches = content.matchAll(rule.pattern);
      
      for (const match of matches) {
        const extracted = rule.extract(match, message);
        
        if (extracted && extracted.length > 5 && extracted.length < 500) {
          const normalized = extracted.toLowerCase().trim();
          
          // Avoid duplicates
          if (seenTexts.has(normalized)) continue;
          seenTexts.add(normalized);

          results.push({
            memoryId: crypto.randomUUID(),
            type: rule.type,
            text: extracted,
            sourceMessage: content.slice(0, 200),
          });

          if (options.maxMemories && results.length >= options.maxMemories) {
            return results;
          }
        }
      }
    }
  }

  return results;
}

/**
 * Extract and store memories from conversation
 */
export async function extractAndStoreMemories(
  messages: CoreMessage[],
  options: ExtractMemoriesOptions
): Promise<ExtractionResult[]> {
  const extractions = extractMemoriesFromMessages(messages, options);
  const stored: ExtractionResult[] = [];

  for (const extraction of extractions) {
    try {
      const entry = storeMemory(
        extraction.text,
        options.userId,
        options.sessionId,
        {
          type: extraction.type,
          sourceMessage: extraction.sourceMessage,
          extractedAt: new Date().toISOString(),
        }
      );
      
      stored.push({ ...extraction, memoryId: entry.id });
      logger.debug("[memory] Extracted and stored", { 
        type: extraction.type, 
        text: extraction.text.slice(0, 50) 
      });
    } catch (e) {
      logger.warn("[memory] Failed to store extracted memory", { error: String(e) });
    }
  }

  return stored;
}

/**
 * Check if conversation contains potential memory material
 */
export function hasMemoryWorthyContent(messages: CoreMessage[]): boolean {
  const MEMORY_KEYWORDS = [
    "remember", "keep in mind", "note that", "don't forget",
    "I prefer", "I like", "I hate", "I always", "I never",
    "I'm a", "I am a", "we're working on", "building", "creating",
    "avoid", "stop doing", "never", "instead", "rather than",
  ];

  for (const message of messages) {
    const content = typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
    
    if (!content) continue;

    const lower = content.toLowerCase();
    for (const keyword of MEMORY_KEYWORDS) {
      if (lower.includes(keyword)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build a memory extraction prompt for LLM-based extraction
 */
export function buildMemoryExtractionPrompt(messages: CoreMessage[]): string {
  const recentMessages = messages.slice(-10);
  
  const conversationText = recentMessages
    .map((m) => {
      const role = m.role === "user" ? "User" : "Assistant";
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${role}: ${content.slice(0, 500)}`;
    })
    .join("\n\n");

  return `From this conversation, identify and save any important information that should persist across future sessions:

${conversationText}

Look for:
- User's role, expertise level, or background
- Explicit memory requests ("remember that...", "keep in mind...")
- Feedback on what works or doesn't work
- Preferences ("I prefer...", "I like...", "avoid...")
- Project context or goals
- Important decisions or patterns

Save each memory using the storeMemory tool with appropriate type (user, feedback, preference, project, context).`;
}
