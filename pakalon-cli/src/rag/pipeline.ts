/**
 * RAG Pipeline — end-to-end semantic component search and AI context injection.
 *
 * Flow: user prompt -> keyword extraction -> registry search -> vector store
 *   (ChromaDB) -> ranked results -> AI context string
 */

import { readComponentRegistry, type ComponentEntry } from "./component-registry.js";
import { retrieveRelevantComponents } from "./component-retriever.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComponentSearchResult {
  component: ComponentEntry;
  score: number;
  source: "registry" | "vector";
  matchedTerms: string[];
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  projectDir?: string;
}

export interface RagInjectionResult {
  injected: boolean;
  results: ComponentSearchResult[];
  contextString: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: SearchOptions = {
  maxResults: 5,
  minScore: 0.3,
  projectDir: process.cwd(),
};

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "this",
  "that", "these", "those", "some", "any", "each", "every", "all",
  "both", "few", "more", "most", "other", "no", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "because", "about",
  "into", "over", "after", "before", "between", "under", "above",
  "below", "up", "down", "out", "off", "if", "then", "else", "when",
  "where", "why", "how", "what", "which", "who", "whom",
  "build", "create", "make", "need", "want", "like", "use", "using",
  "get", "please", "help",
]);

function extractKeywords(query: string): string[] {
  const normalized = query.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const terms = normalized
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  return [...new Set(terms)];
}

export { extractKeywords };

// ---------------------------------------------------------------------------
// Technology detection
// ---------------------------------------------------------------------------

const TECH_KEYWORDS: Record<string, string[]> = {
  react: ["react", "jsx", "tsx", "component", "hook", "state", "props"],
  vue: ["vue", "vuejs", "template", "component"],
  tailwind: ["tailwind", "tailwindcss", "utility"],
  shadcn: ["shadcn", "shadcn/ui"],
  typescript: ["typescript", "ts", "type"],
  javascript: ["javascript", "js", "es6"],
  python: ["python", "django", "flask", "fastapi"],
  nextjs: ["next", "nextjs", "ssr", "server component"],
};

function detectTechnologies(query: string): string[] {
  const q = query.toLowerCase();
  const detected: string[] = [];
  for (const [tech, keywords] of Object.entries(TECH_KEYWORDS)) {
    if (keywords.some((kw) => q.includes(kw))) {
      detected.push(tech);
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreResult(
  component: ComponentEntry,
  keywords: string[],
  technologies: string[],
): { score: number; matchedTerms: string[] } {
  const haystack = `${component.name} ${component.description} ${component.tags.join(" ")} ${component.category}`.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      score += 0.3;
      matchedTerms.push(keyword);
    }
  }

  const componentName = component.name.toLowerCase();
  for (const keyword of keywords) {
    if (componentName.includes(keyword)) {
      score += 0.5;
    }
  }

  for (const tech of technologies) {
    if (haystack.includes(tech)) {
      score += 0.2;
    }
  }

  return {
    score: Math.min(score, 1.0),
    matchedTerms,
  };
}

// ---------------------------------------------------------------------------
// Main search pipeline
// ---------------------------------------------------------------------------

export async function searchComponents(
  query: string,
  options?: Partial<SearchOptions>,
): Promise<ComponentSearchResult[]> {
  const opts: SearchOptions = { ...DEFAULT_OPTIONS, ...options };
  const keywords = extractKeywords(query);
  const technologies = detectTechnologies(query);

  if (keywords.length === 0) {
    return [];
  }

  logger.info(`[RAG] Searching: "${query}" (keywords: ${keywords.join(", ")}, tech: ${technologies.join(", ")})`);

  const allResults: ComponentSearchResult[] = [];
  const seenIds = new Set<string>();

  // Step 1: Local registry search
  try {
    const registry = readComponentRegistry(opts.projectDir!);
    if (registry && registry.components.length > 0) {
      for (const component of registry.components) {
        const { score, matchedTerms } = scoreResult(component, keywords, technologies);
        if (score >= (opts.minScore ?? 0.3)) {
          allResults.push({ component, score, source: "registry", matchedTerms });
          seenIds.add(component.id);
        }
      }
    }
  } catch (error) {
    logger.warn(`[RAG] Registry search failed: ${error}`);
  }

  // Step 2: Vector/semantic search via retriever
  try {
    const registry = readComponentRegistry(opts.projectDir!);
    const vectorMatches = retrieveRelevantComponents(query, registry, { topK: opts.maxResults });
    for (const match of vectorMatches) {
      if (!seenIds.has(match.entry.id)) {
        allResults.push({
          component: match.entry,
          score: Math.max(match.score, 0),
          source: "vector",
          matchedTerms: match.reasons,
        });
        seenIds.add(match.entry.id);
      }
    }
  } catch (error) {
    logger.warn(`[RAG] Vector search failed: ${error}`);
  }

  allResults.sort((a, b) => b.score - a.score);
  return allResults.slice(0, opts.maxResults ?? 5);
}

// ---------------------------------------------------------------------------
// AI Context injection
// ---------------------------------------------------------------------------

export async function injectComponentsIntoContext(
  query: string,
  messages: Array<{ role: string; content: string }>,
  options?: Partial<SearchOptions>,
): Promise<RagInjectionResult> {
  const results = await searchComponents(query, options);

  if (results.length === 0) {
    return { injected: false, results: [], contextString: "" };
  }

  const contextParts: string[] = [];
  contextParts.push("<component_recommendations>");
  contextParts.push(`The following components may be relevant to the user's request about "${query}":`);
  contextParts.push("");

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const c = r.component;
    contextParts.push(`--- Component ${i + 1}: ${c.name} (${r.source}, score: ${r.score.toFixed(2)}) ---`);
    contextParts.push(`Source: ${c.sourceUrl}`);
    contextParts.push("Code:");
    contextParts.push(c.code.substring(0, 2000));
    contextParts.push("");
  }

  contextParts.push("</component_recommendations>");
  const contextString = contextParts.join("\n");

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      const original = messages[i]!.content;
      messages[i]!.content = contextString + "\n\n" + original;
      break;
    }
  }

  return { injected: true, results, contextString };
}

// ---------------------------------------------------------------------------
// Context string builder
// ---------------------------------------------------------------------------

export function buildRagContextString(
  results: ComponentSearchResult[],
  maxTokens: number = 3000,
): string {
  if (!results.length) return "";

  let totalChars = 0;
  const maxChars = maxTokens * 4;
  const parts: string[] = [];

  parts.push("Available components:");
  parts.push("");

  for (const r of results) {
    const c = r.component;
    const entry = [
      `- ${c.name}`,
      `  Description: ${c.description}`,
      `  Source: ${c.sourceUrl}`,
      c.dependencies?.length ? `  Dependencies: ${c.dependencies.join(", ")}` : null,
    ].filter(Boolean).join("\n");
    const newChars = entry.length + 1;

    if (totalChars + newChars > maxChars) break;
    totalChars += newChars;
    parts.push(entry);
  }

  return parts.join("\n");
}

export default {
  searchComponents,
  injectComponentsIntoContext,
  buildRagContextString,
  extractKeywords,
};