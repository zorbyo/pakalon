import logger from "@/utils/logger.js";
import { searchComponents, type ComponentResult } from "@/tools/component-rag.js";

const STYLE_TERMS = [
  "minimal", "clean", "modern", "glass", "glassmorphism", "dark", "light", "gradient",
  "animated", "motion", "dashboard", "landing", "hero", "pricing", "sidebar", "navbar",
  "form", "modal", "card", "table", "tabs", "accordion", "toast", "chart", "auth",
  "login", "signup", "onboarding", "marketing", "admin", "docs", "search", "filter",
  "profile", "settings", "portfolio", "ecommerce",
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTerms(input: string): string[] {
  return Array.from(new Set(
    normalizeText(input)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2),
  ));
}

function scoreStyleMatch(result: ComponentResult, styleTerms: string[]): number {
  const haystack = `${result.source.name} ${result.source.description} ${result.source.tags.join(" ")} ${result.source.category}`.toLowerCase();
  return styleTerms.reduce((score, term) => score + (haystack.includes(term) ? 0.35 : 0), 0);
}

function formatWireframes(wireframes: string[]): string {
  if (!wireframes.length) return "";
  return wireframes.map((wireframe, index) => `Wireframe ${index + 1}: ${normalizeText(wireframe).slice(0, 600)}`).join("\n");
}

function formatResult(result: ComponentResult, index: number): string {
  const source = result.source;
  const code = source.sourceCode ? source.sourceCode.slice(0, 1800) : "";
  return [
    `### ${index + 1}. ${source.name}`,
    `- Relevance: ${result.relevanceScore.toFixed(2)}`,
    `- Category: ${source.category}`,
    `- Framework: ${source.framework}`,
    `- URL: ${source.url}`,
    `- Matched terms: ${result.matchedTerms.join(", ") || "none"}`,
    `- Description: ${source.description}`,
    code ? `- Source code:\n\n\`\`\`tsx\n${code}\n\`\`\`` : "",
  ].filter(Boolean).join("\n");
}

export async function buildComponentContext(userPrompt: string, wireframes: string[] = []): Promise<string> {
  const prompt = normalizeText(userPrompt);
  const wireframeText = wireframes.join("\n");
  const query = [prompt, wireframeText].filter(Boolean).join("\n");
  const styleTerms = Array.from(new Set([
    ...STYLE_TERMS.filter((term) => query.toLowerCase().includes(term)),
    ...extractTerms(query),
  ]));

  try {
    const results = await searchComponents(query, 10);
    const reranked = [...results]
      .map((result) => ({
        ...result,
        relevanceScore: result.relevanceScore + scoreStyleMatch(result, styleTerms),
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const top = reranked.slice(0, 6);

    return [
      "<component_rag_context>",
      `User prompt: ${prompt}`,
      wireframes.length ? `Wireframes:\n${formatWireframes(wireframes)}` : "Wireframes: none",
      `Style signals: ${styleTerms.join(", ") || "none"}`,
      "",
      "Recommended components:",
      ...top.map((result, index) => formatResult(result, index)),
      "</component_rag_context>",
    ].join("\n");
  } catch (error) {
    logger.warn(`[component-context-builder] Failed to build context: ${String(error)}`);
    return [
      "<component_rag_context>",
      `User prompt: ${prompt}`,
      wireframes.length ? `Wireframes:\n${formatWireframes(wireframes)}` : "Wireframes: none",
      "Recommended components: none available",
      "</component_rag_context>",
    ].join("\n");
  }
}

export default {
  buildComponentContext,
};
