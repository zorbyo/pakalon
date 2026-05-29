/**
 * RAG Context Injector
 *
 * Integration point that hooks the RAG pipeline into the AI message pipeline.
 * Provides functions to detect when RAG is useful and inject component
 * recommendations into conversation context.
 */

import { searchComponents, buildRagContextString, extractKeywords } from "./pipeline.js";
import type { ComponentSearchResult } from "./pipeline.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// RAG injection heuristics
// ---------------------------------------------------------------------------

const RAG_TRIGGER_PATTERNS = [
  /component/i,
  /ui\s*(element|library|kit)/i,
  /button|card|modal|form|input|table|dropdown/i,
  /navigation|sidebar|header|footer/i,
  /shadcn|daisyui|tailwindui/i,
  /design\s*system|theme/i,
  /layout|grid|flex|responsive/i,
  /widget|panel|dialog|tooltip|popover|toast/i,
  /chart|graph|datatable|list|avatar|badge|tag/i,
];

/**
 * Determine if a user query would benefit from RAG component injection
 */
export function shouldInjectRag(query: string): boolean {
  if (!query || query.trim().length < 5) return false;

  // Check for trigger patterns
  for (const pattern of RAG_TRIGGER_PATTERNS) {
    if (pattern.test(query)) {
      return true;
    }
  }

  // Check for relevant keywords
  const keywords = extractKeywords(query);
  const uiKeywords = [
    "component", "ui", "button", "card", "modal", "form", "input",
    "table", "dropdown", "navigation", "sidebar", "layout", "widget",
    "panel", "dialog", "tooltip", "popover", "toast", "chart",
    "design", "theme", "style", "template", "element",
  ];

  return keywords.some((kw) => uiKeywords.includes(kw));
}

// ---------------------------------------------------------------------------
// Keyword extraction for search
// ---------------------------------------------------------------------------

/**
 * Extract search-relevant keywords from a natural language query.
 * Filters out common UI-building verbs and focuses on nouns
 */
export function extractSearchKeywords(query: string): string[] {
  const keywords = extractKeywords(query);

  // Remove generic UI-building verbs
  const genericVerbs = [
    "build", "create", "make", "add", "need", "want",
    "implement", "design", "develop", "write", "code",
    "show", "display", "render", "generate", "setup",
    "configure", "install", "use", "using", "get",
  ];

  return keywords.filter((kw) => !genericVerbs.includes(kw));
}

// ---------------------------------------------------------------------------
// Message injection
// ---------------------------------------------------------------------------

export interface RagInjectionOptions {
  maxResults?: number;
  minScore?: number;
  allowWebFallback?: boolean;
  projectDir?: string;
  maxTokens?: number;
}

/**
 * Inject RAG context into an array of messages for AI consumption.
 * Returns whether any context was injected and what the context looks like.
 */
export async function injectRagContext(
  messages: Array<{ role: string; content: string }>,
  projectDir?: string,
): Promise<{ injected: boolean; context: string }> {
  if (!messages.length) return { injected: false, context: "" };

  // Find the last user mess age
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex < 0) return { injected: false, context: "" };

  const userMessage = messages[lastUserIndex]!;
  const query = typeof userMessage.content === "string" ? userMessage.content : "";

  if (!shouldInjectRag(query)) return { injected: false, context: "" };

  const keywords = extractSearchKeywords(query);
  if (keywords.length === 0) return { injected: false, context: "" };

  try {
    const results = await searchComponents(query, {
      projectDir,
      maxResults: 5,
      minScore: 0.3,
    });

    if (results.length === 0) return { injected: false, context: "" };

    const context = buildRagContextString(results, 2000);
    if (!context) return { injected: false, context: "" };

    // Append context to user message
    userMessage.content = context + "\n\n" + userMessage.content;

    logger.info(`[RAG] Injected ${results.length} component(s) into context`);
    return { injected: true, context };
  } catch (error) {
    logger.warn(`[RAG] Context injection failed: ${error}`);
    return { injected: false, context: "" };
  }
}

export default {
  shouldInjectRag,
  extractSearchKeywords,
  injectRagContext,
};