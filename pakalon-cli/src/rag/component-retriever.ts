import type { ComponentEntry, ComponentRegistry } from "./component-registry.js";

export interface ComponentMatch {
  entry: ComponentEntry;
  score: number;
  reasons: string[];
}

export interface ComponentRetrievalOptions {
  topK?: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).map((token) => token.trim()).filter((token) => token.length > 1);
}

function uniqueTokens(text: string): Set<string> {
  return new Set(tokenize(text));
}

function buildVector(text: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokenize(text)) vector.set(token, (vector.get(token) ?? 0) + 1);
  return vector;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const value of a.values()) magA += value * value;
  for (const value of b.values()) magB += value * value;

  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) dot += (a.get(key) ?? 0) * (b.get(key) ?? 0);

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function keywordOverlap(queryTokens: Set<string>, haystackTokens: Set<string>): { score: number; matches: string[] } {
  const matches = [...queryTokens].filter((token) => haystackTokens.has(token));
  if (queryTokens.size === 0) return { score: 0, matches: [] };
  return { score: matches.length / queryTokens.size, matches };
}

function componentText(entry: ComponentEntry): string {
  return [entry.name, entry.description, entry.category, entry.framework, entry.tags.join(" "), entry.code, entry.dependencies?.join(" ") ?? ""].join(" ");
}

function normalizeScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

export function retrieveRelevantComponents(query: string, registry: ComponentRegistry, options: ComponentRetrievalOptions = {}): ComponentMatch[] {
  const topK = options.topK ?? 5;
  const queryTokens = uniqueTokens(query);
  const queryVector = buildVector(query);

  const scored = registry.components.map((entry) => {
    const text = componentText(entry);
    const textTokens = uniqueTokens(text);
    const entryVector = buildVector(text);
    const keyword = keywordOverlap(queryTokens, textTokens);
    const vector = cosineSimilarity(queryVector, entryVector);
    const tagBoost = entry.tags.some((tag) => queryTokens.has(tag.toLowerCase())) ? 0.12 : 0;
    const categoryBoost = queryTokens.has(entry.category) ? 0.1 : 0;
    const frameworkBoost = queryTokens.has(entry.framework) ? 0.08 : 0;
    const complexityPenalty = entry.complexity === "complex" ? 0.04 : 0;

    const score = normalizeScore((keyword.score * 0.5) + (vector * 0.4) + tagBoost + categoryBoost + frameworkBoost - complexityPenalty);
    const reasons = [
      ...(keyword.matches.length ? [`keyword match: ${keyword.matches.slice(0, 5).join(", ")}`] : []),
      ...(tagBoost > 0 ? ["tag alignment"] : []),
      ...(categoryBoost > 0 ? ["category alignment"] : []),
      ...(frameworkBoost > 0 ? ["framework alignment"] : []),
    ];

    return { entry, score, reasons };
  });

  return scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name)).slice(0, topK);
}

export function formatComponentMatches(matches: ComponentMatch[]): string {
  if (!matches.length) return "No registry components matched the request.";

  return [
    "## Relevant registry components",
    ...matches.map((match, index) => [
      `${index + 1}. ${match.entry.name} (${match.entry.framework}, ${match.entry.category}, ${match.entry.complexity})`,
      `   - score: ${match.score.toFixed(2)}`,
      `   - tags: ${match.entry.tags.join(", ") || "none"}`,
      `   - source: ${match.entry.sourceUrl}`,
      `   - why: ${match.reasons.join("; ") || "semantic similarity"}`,
      `   - description: ${match.entry.description}`,
    ].join("\n")),
  ].join("\n");
}

export function buildComponentRegistryContext(query: string, registry: ComponentRegistry, options: ComponentRetrievalOptions = {}): string {
  return formatComponentMatches(retrieveRelevantComponents(query, registry, options));
}
