/**
 * Local Skill Search Service
 *
 * Provides fuzzy and semantic search over locally installed skills
 * with ranking based on relevance, recency, and usage frequency.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverSkillCatalog,
  type SkillCatalogEntry,
  type SkillCatalogSource,
} from "@/skills/catalog.js";
import logger from "@/utils/logger.js";

export interface SkillSearchOptions {
  projectDir?: string;
  sources?: SkillCatalogSource[];
  limit?: number;
  includeContent?: boolean;
  fuzzyThreshold?: number;
}

export interface SkillSearchMatch {
  entry: SkillCatalogEntry;
  score: number;
  matchFields: string[];
}

export interface SkillSearchResult {
  matches: SkillSearchMatch[];
  query: string;
  totalScanned: number;
  elapsedMs: number;
}

const SKILL_USAGE_CACHE_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "skill-usage.json",
);

interface SkillUsageRecord {
  lastUsed: number;
  useCount: number;
}

function loadSkillUsageCache(): Map<string, SkillUsageRecord> {
  try {
    if (fs.existsSync(SKILL_USAGE_CACHE_PATH)) {
      const raw = fs.readFileSync(SKILL_USAGE_CACHE_PATH, "utf-8");
      const data = JSON.parse(raw) as Record<string, SkillUsageRecord>;
      return new Map(Object.entries(data));
    }
  } catch {
    // Cache corrupted or unreadable
  }
  return new Map();
}

function saveSkillUsageCache(cache: Map<string, SkillUsageRecord>): void {
  try {
    const dir = path.dirname(SKILL_USAGE_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, SkillUsageRecord> = Object.fromEntries(cache);
    fs.writeFileSync(SKILL_USAGE_CACHE_PATH, JSON.stringify(data, null, 2));
  } catch {
    // Best effort
  }
}

export function recordSkillUsage(skillName: string): void {
  const cache = loadSkillUsageCache();
  const existing = cache.get(skillName) ?? { lastUsed: 0, useCount: 0 };
  cache.set(skillName, {
    lastUsed: Date.now(),
    useCount: existing.useCount + 1,
  });
  saveSkillUsageCache(cache);
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[b.length]![a.length]!;
}

function fuzzyScore(query: string, target: string, threshold: number): number {
  const qTokens = tokenize(query);
  const tTokens = tokenize(target);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  let totalScore = 0;
  let matchedTokens = 0;

  for (const qt of qTokens) {
    let bestTokenScore = 0;
    for (const tt of tTokens) {
      if (tt.includes(qt)) {
        bestTokenScore = Math.max(bestTokenScore, qt.length / tt.length);
      } else {
        const dist = levenshtein(qt, tt);
        const maxLen = Math.max(qt.length, tt.length);
        const sim = 1 - dist / maxLen;
        if (sim >= threshold) {
          bestTokenScore = Math.max(bestTokenScore, sim);
        }
      }
    }
    if (bestTokenScore > 0) {
      totalScore += bestTokenScore;
      matchedTokens++;
    }
  }

  if (matchedTokens === 0) return 0;
  return (totalScore / qTokens.length) * (matchedTokens / qTokens.length);
}

function computeUsageBoost(skillName: string): number {
  const cache = loadSkillUsageCache();
  const record = cache.get(skillName);
  if (!record) return 0;

  const daysSinceUse = (Date.now() - record.lastUsed) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(0, 1 - daysSinceUse / 30);
  const frequencyFactor = Math.min(1, record.useCount / 10);

  return (recencyFactor * 0.6 + frequencyFactor * 0.4) * 0.15;
}

function computeSourceBoost(source: SkillCatalogSource): number {
  switch (source) {
    case "project":
      return 0.1;
    case "global":
      return 0.05;
    case "embedded":
      return 0.02;
    case "vendored":
      return 0;
  }
}

function scoreSkill(
  entry: SkillCatalogEntry,
  query: string,
  fuzzyThreshold: number,
): SkillSearchMatch | null {
  const fields: { name: string; value: string; weight: number }[] = [
    { name: "name", value: entry.name, weight: 1.0 },
    { name: "description", value: entry.description, weight: 0.6 },
    { name: "keywords", value: entry.keywords.join(" "), weight: 0.8 },
    { name: "triggers", value: entry.triggers.join(" "), weight: 0.7 },
    { name: "content", value: entry.content ?? "", weight: 0.3 },
  ];

  let bestScore = 0;
  const matchFields: string[] = [];

  for (const field of fields) {
    if (!field.value) continue;
    const score = fuzzyScore(query, field.value, fuzzyThreshold);
    if (score > 0) {
      const weighted = score * field.weight;
      if (weighted > bestScore) {
        bestScore = weighted;
      }
      matchFields.push(field.name);
    }
  }

  if (bestScore === 0) return null;

  const usageBoost = computeUsageBoost(entry.name);
  const sourceBoost = computeSourceBoost(entry.source);
  const finalScore = Math.min(1, bestScore + usageBoost + sourceBoost);

  return { entry, score: finalScore, matchFields };
}

export async function searchLocalSkills(
  query: string,
  options?: SkillSearchOptions,
): Promise<SkillSearchResult> {
  const start = performance.now();
  const fuzzyThreshold = options?.fuzzyThreshold ?? 0.5;
  const limit = options?.limit ?? 20;

  const entries = discoverSkillCatalog({
    includeContent: options?.includeContent ?? false,
    projectDir: options?.projectDir,
    sources: options?.sources,
  });

  const matches: SkillSearchMatch[] = [];

  for (const entry of entries) {
    const match = scoreSkill(entry, query, fuzzyThreshold);
    if (match) {
      matches.push(match);
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const trimmed = matches.slice(0, limit);

  const elapsed = performance.now() - start;

  logger.debug("[skillSearch] local search completed", {
    query,
    totalScanned: entries.length,
    matchesFound: trimmed.length,
    elapsedMs: Math.round(elapsed),
  });

  return {
    matches: trimmed,
    query,
    totalScanned: entries.length,
    elapsedMs: Math.round(elapsed),
  };
}

export async function findExactSkill(
  name: string,
  options?: SkillSearchOptions,
): Promise<SkillSearchMatch | null> {
  const entries = discoverSkillCatalog({
    includeContent: options?.includeContent ?? true,
    projectDir: options?.projectDir,
    sources: options?.sources,
  });

  const needle = name.toLowerCase();
  for (const entry of entries) {
    if (entry.name.toLowerCase() === needle) {
      return { entry, score: 1.0, matchFields: ["name"] };
    }
  }
  return null;
}

export async function listAllSkills(
  options?: SkillSearchOptions,
): Promise<SkillCatalogEntry[]> {
  return discoverSkillCatalog({
    includeContent: options?.includeContent ?? false,
    projectDir: options?.projectDir,
    sources: options?.sources,
  });
}
