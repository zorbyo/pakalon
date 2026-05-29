/**
 * File Read Cache
 *
 * LRU cache for file contents to reduce redundant disk I/O.
 * Automatically invalidates entries when files change on disk.
 *
 * Features:
 * - LRU eviction with configurable max size
 * - Content hash-based invalidation
 * - TTL-based expiration
 * - Stats tracking for cache hit/miss rates
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import logger from "@/utils/logger.js";

export interface FileCacheEntry {
  content: string;
  hash: string;
  size: number;
  mtime: number;
  readCount: number;
  lastRead: number;
  createdAt: number;
}

export interface FileReadCacheConfig {
  maxEntries?: number;
  maxFileSize?: number;
  ttlMs?: number;
  enabled?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  hitRate: number;
  entryCount: number;
  totalSize: number;
}

const DEFAULT_CONFIG: Required<FileReadCacheConfig> = {
  maxEntries: 500,
  maxFileSize: 1024 * 1024, // 1MB
  ttlMs: 30000, // 30s
  enabled: true,
};

class FileReadCache {
  private cache = new Map<string, FileCacheEntry>();
  private accessOrder: string[] = [];
  private config: Required<FileReadCacheConfig>;
  private stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };

  constructor(config: FileReadCacheConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private computeHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private isEntryValid(entry: FileCacheEntry, filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs !== entry.mtime) {
        return false;
      }
      if (this.config.ttlMs > 0 && Date.now() - entry.createdAt > this.config.ttlMs) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private evictOldest(): void {
    while (this.cache.size >= this.config.maxEntries && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest && this.cache.has(oldest)) {
        this.cache.delete(oldest);
        this.stats.evictions++;
      }
    }
  }

  private touch(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);
  }

  get(filePath: string): string | null {
    if (!this.config.enabled) return null;

    const normalized = path.resolve(filePath);

    if (!this.cache.has(normalized)) {
      this.stats.misses++;
      return null;
    }

    const entry = this.cache.get(normalized)!;

    if (!this.isEntryValid(entry, normalized)) {
      this.cache.delete(normalized);
      this.accessOrder = this.accessOrder.filter((k) => k !== normalized);
      this.stats.invalidations++;
      this.stats.misses++;
      return null;
    }

    entry.readCount++;
    entry.lastRead = Date.now();
    this.touch(normalized);
    this.stats.hits++;

    return entry.content;
  }

  set(filePath: string, content: string): void {
    if (!this.config.enabled) return;

    const normalized = path.resolve(filePath);

    if (content.length > this.config.maxFileSize) {
      logger.debug("[fileReadCache] File too large to cache", { path: normalized, size: content.length });
      return;
    }

    this.evictOldest();

    const stat = fs.statSync(normalized);
    const entry: FileCacheEntry = {
      content,
      hash: this.computeHash(content),
      size: content.length,
      mtime: stat.mtimeMs,
      readCount: 1,
      lastRead: Date.now(),
      createdAt: Date.now(),
    };

    this.cache.set(normalized, entry);
    this.touch(normalized);
  }

  invalidate(filePath: string): void {
    const normalized = path.resolve(filePath);
    if (this.cache.has(normalized)) {
      this.cache.delete(normalized);
      this.accessOrder = this.accessOrder.filter((k) => k !== normalized);
      this.stats.invalidations++;
    }
  }

  invalidateAll(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.invalidations += this.stats.hits + this.stats.misses;
  }

  has(filePath: string): boolean {
    const normalized = path.resolve(filePath);
    if (!this.cache.has(normalized)) return false;
    const entry = this.cache.get(normalized)!;
    return this.isEntryValid(entry, normalized);
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
    }

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      invalidations: this.stats.invalidations,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      entryCount: this.cache.size,
      totalSize,
    };
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
}

let globalCache: FileReadCache | null = null;

export function getFileReadCache(config?: FileReadCacheConfig): FileReadCache {
  if (!globalCache) {
    globalCache = new FileReadCache(config);
  }
  return globalCache;
}

export function readCachedFile(filePath: string, encoding: BufferEncoding = "utf-8"): string | null {
  const cache = getFileReadCache();
  const cached = cache.get(filePath);
  if (cached) return cached;

  try {
    const content = fs.readFileSync(filePath, encoding);
    if (typeof content === "string") {
      cache.set(filePath, content);
    }
    return content as string;
  } catch (err) {
    logger.debug("[fileReadCache] Failed to read file", { path: filePath, error: err });
    return null;
  }
}

export async function readCachedFileAsync(filePath: string, encoding: BufferEncoding = "utf-8"): Promise<string | null> {
  const cache = getFileReadCache();
  const cached = cache.get(filePath);
  if (cached) return cached;

  try {
    const content = await fs.promises.readFile(filePath, encoding);
    cache.set(filePath, content);
    return content;
  } catch (err) {
    logger.debug("[fileReadCache] Failed to read file", { path: filePath, error: err });
    return null;
  }
}

export function invalidateCachedFile(filePath: string): void {
  getFileReadCache().invalidate(filePath);
}

export function getCacheStats(): CacheStats {
  return getFileReadCache().getStats();
}

export function resetCache(): void {
  getFileReadCache().clear();
}

export { FileReadCache };
