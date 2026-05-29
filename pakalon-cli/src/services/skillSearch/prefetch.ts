/**
 * Skill Prefetch Service
 *
 * Proactively loads and caches skill content in the background
 * to reduce latency when skills are invoked.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverSkillCatalog, type SkillCatalogEntry } from "@/skills/catalog.js";
import logger from "@/utils/logger.js";

export interface PrefetchConfig {
  maxCacheSizeMB?: number;
  ttlMs?: number;
  maxEntries?: number;
  projectDir?: string;
}

export interface PrefetchEntry {
  skill: SkillCatalogEntry;
  loadedAt: number;
  accessedAt: number;
  sizeBytes: number;
}

export interface PrefetchStats {
  totalCached: number;
  totalSizeBytes: number;
  oldestEntry: number;
  newestEntry: number;
  hitRate: number;
}

const PREFETCH_CACHE_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "skill-prefetch-cache",
);

const DEFAULT_CONFIG: Required<PrefetchConfig> = {
  maxCacheSizeMB: 50,
  ttlMs: 30 * 60 * 1000,
  maxEntries: 100,
  projectDir: process.cwd(),
};

let cache = new Map<string, PrefetchEntry>();
let hitCount = 0;
let missCount = 0;
let prefetchRunning = false;

function getCacheDir(): string {
  return PREFETCH_CACHE_PATH;
}

function estimateEntrySize(entry: SkillCatalogEntry): number {
  return Buffer.byteLength(entry.content ?? entry.description, "utf-8");
}

function evictIfNeeded(config: Required<PrefetchConfig>): void {
  const maxSizeBytes = config.maxCacheSizeMB * 1024 * 1024;
  const now = Date.now();

  for (const [key, entry] of cache) {
    if (now - entry.loadedAt > config.ttlMs) {
      cache.delete(key);
    }
  }

  while (cache.size > config.maxEntries) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      cache.delete(oldestKey);
    } else {
      break;
    }
  }

  let totalSize = 0;
  for (const entry of cache.values()) {
    totalSize += entry.sizeBytes;
  }

  while (totalSize > maxSizeBytes && cache.size > 0) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const removed = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (removed) {
        totalSize -= removed.sizeBytes;
      }
    } else {
      break;
    }
  }
}

async function persistCacheToDisk(): Promise<void> {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    for (const [key, entry] of cache) {
      if (entry.skill.content) {
        const safeName = key.replace(/[^a-z0-9_-]/gi, "_");
        const filePath = path.join(dir, `${safeName}.md`);
        fs.writeFileSync(filePath, entry.skill.content, "utf-8");
      }
    }
  } catch (err) {
    logger.warn("[prefetch] failed to persist cache", err);
  }
}

async function loadCacheFromDisk(projectDir: string): Promise<void> {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
      const skillName = entry.name.replace(/\.md$/, "").replace(/_/g, "-");

      cache.set(skillName, {
        skill: {
          name: skillName,
          description: content.slice(0, 200),
          source: "global",
          path: path.join(dir, entry.name),
          rootDir: dir,
          content,
          frontmatter: {},
          keywords: [],
          triggers: [],
        },
        loadedAt: Date.now(),
        accessedAt: Date.now(),
        sizeBytes: Buffer.byteLength(content, "utf-8"),
      });
    }
  } catch (err) {
    logger.warn("[prefetch] failed to load disk cache", err);
  }
}

export async function prefetchSkills(
  config?: PrefetchConfig,
): Promise<number> {
  if (prefetchRunning) {
    logger.debug("[prefetch] already running, skipping");
    return cache.size;
  }

  prefetchRunning = true;
  const resolved = { ...DEFAULT_CONFIG, ...config };

  try {
    await loadCacheFromDisk(resolved.projectDir);

    const skills = discoverSkillCatalog({
      includeContent: true,
      projectDir: resolved.projectDir,
    });

    for (const skill of skills) {
      if (cache.has(skill.name)) {
        const existing = cache.get(skill.name)!;
        existing.accessedAt = Date.now();
        continue;
      }

      const sizeBytes = estimateEntrySize(skill);
      cache.set(skill.name, {
        skill,
        loadedAt: Date.now(),
        accessedAt: Date.now(),
        sizeBytes,
      });
    }

    evictIfNeeded(resolved);
    await persistCacheToDisk();

    logger.info("[prefetch] completed", {
      cached: cache.size,
      totalSkills: skills.length,
    });

    return cache.size;
  } finally {
    prefetchRunning = false;
  }
}

export function getCachedSkill(name: string): SkillCatalogEntry | null {
  const entry = cache.get(name);
  if (entry) {
    entry.accessedAt = Date.now();
    hitCount++;
    return entry.skill;
  }
  missCount++;
  return null;
}

export function getCachedSkills(): SkillCatalogEntry[] {
  return Array.from(cache.values()).map((e) => e.skill);
}

export function getPrefetchStats(): PrefetchStats {
  const total = hitCount + missCount;
  let oldestEntry = Infinity;
  let newestEntry = 0;
  let totalSizeBytes = 0;

  for (const entry of cache.values()) {
    if (entry.loadedAt < oldestEntry) oldestEntry = entry.loadedAt;
    if (entry.loadedAt > newestEntry) newestEntry = entry.loadedAt;
    totalSizeBytes += entry.sizeBytes;
  }

  return {
    totalCached: cache.size,
    totalSizeBytes,
    oldestEntry: oldestEntry === Infinity ? 0 : oldestEntry,
    newestEntry,
    hitRate: total > 0 ? hitCount / total : 0,
  };
}

export function clearPrefetchCache(): void {
  cache.clear();
  hitCount = 0;
  missCount = 0;
  try {
    const dir = getCacheDir();
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Best effort
  }
  logger.info("[prefetch] cache cleared");
}

export async function warmupSkills(skillNames: string[], config?: PrefetchConfig): Promise<void> {
  const resolved = { ...DEFAULT_CONFIG, ...config };
  const skills = discoverSkillCatalog({
    includeContent: true,
    projectDir: resolved.projectDir,
  });

  const nameSet = new Set(skillNames.map((n) => n.toLowerCase()));

  for (const skill of skills) {
    if (nameSet.has(skill.name.toLowerCase())) {
      if (!cache.has(skill.name)) {
        cache.set(skill.name, {
          skill,
          loadedAt: Date.now(),
          accessedAt: Date.now(),
          sizeBytes: estimateEntrySize(skill),
        });
      }
    }
  }

  evictIfNeeded(resolved);
  logger.info("[prefetch] warmup completed", { warmed: skillNames.length });
}
