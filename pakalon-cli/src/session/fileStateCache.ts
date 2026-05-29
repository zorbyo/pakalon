/**
 * File State Cache
 * 
 * LRU cache for file content and metadata used by subagent context.
 * Normalizes path keys for consistent cache hits regardless of path format.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger.js';
import type { FileState, FileStateCacheConfig } from './types.js';

const DEFAULT_CACHE_CONFIG: FileStateCacheConfig = {
  maxSize: 1000,
  maxAge: 60000,
  hashContent: true,
};

const DEFAULT_MAX_CACHE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

interface CacheEntry {
  content: string;
  timestamp: number;
  offset?: number;
  limit?: number;
  isPartialView?: boolean;
  hash?: string;
  size?: number;
  mtime?: number;
  lastRead: number;
}

/**
 * File state cache with normalized path keys
 */
export class FileStateCache {
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private config: Required<FileStateCacheConfig>;
  private totalSize = 0;

  constructor(config: Partial<FileStateCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Normalize path key for consistent cache lookups
   */
  private normalizeKey(key: string): string {
    return path.normalize(key).replace(/\\/g, '/');
  }

  /**
   * Generate hash for file content
   */
  private generateHash(filePath: string, content?: string): string {
    if (!this.config.hashContent) {
      return '';
    }

    try {
      if (content) {
        return crypto.createHash('md5').update(content).digest('hex');
      }
      const stat = fs.statSync(filePath);
      const hashInput = `${filePath}-${stat.mtimeMs}-${stat.size}`;
      return crypto.createHash('md5').update(hashInput).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Get entry from cache
   */
  get(key: string): FileState | null {
    const normalized = this.normalizeKey(key);
    const entry = this.cache.get(normalized);

    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > this.config.maxAge) {
      this.delete(normalized);
      return null;
    }

    entry.lastRead = Date.now();
    this.updateAccessOrder(normalized);

    return {
      content: entry.content,
      timestamp: entry.timestamp,
      offset: entry.offset,
      limit: entry.limit,
      isPartialView: entry.isPartialView,
      hash: entry.hash,
      size: entry.size,
      mtime: entry.mtime,
    };
  }

  /**
   * Set entry in cache
   */
  set(key: string, value: Partial<FileState>): void {
    const normalized = this.normalizeKey(key);

    const existingEntry = this.cache.get(normalized);
    if (existingEntry) {
      this.totalSize -= Buffer.byteLength(existingEntry.content, 'utf-8');
    }

    let content = value.content || '';
    if (!content && value.hash === undefined) {
      try {
        if (fs.existsSync(normalized)) {
          content = fs.readFileSync(normalized, 'utf-8');
        }
      } catch {
        // File may not exist, use empty content
      }
    }

    const stat = value.mtime !== undefined || value.size !== undefined
      ? { mtimeMs: value.mtime || 0, size: value.size || 0 }
      : this.getFileStat(normalized);

    const entry: CacheEntry = {
      content,
      timestamp: value.timestamp || Date.now(),
      offset: value.offset,
      limit: value.limit,
      isPartialView: value.isPartialView,
      hash: value.hash || this.generateHash(normalized, content),
      size: stat.size,
      mtime: stat.mtimeMs,
      lastRead: Date.now(),
    };

    this.evictIfNeeded();
    this.cache.set(normalized, entry);
    this.updateAccessOrder(normalized);
    this.totalSize += Buffer.byteLength(content, 'utf-8');
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    const normalized = this.normalizeKey(key);
    const entry = this.cache.get(normalized);

    if (!entry) {
      return false;
    }

    if (Date.now() - entry.timestamp > this.config.maxAge) {
      this.delete(normalized);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const normalized = this.normalizeKey(key);
    const entry = this.cache.get(normalized);

    if (entry) {
      this.totalSize -= Buffer.byteLength(entry.content, 'utf-8');
      this.cache.delete(normalized);
      this.accessOrder = this.accessOrder.filter((k) => k !== normalized);
      return true;
    }

    return false;
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.totalSize = 0;
  }

  /**
   * Get cache size (number of entries)
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get max entries configured
   */
  get max(): number {
    return this.config.maxSize;
  }

  /**
   * Get calculated size in bytes
   */
  get calculatedSize(): number {
    return this.totalSize;
  }

  /**
   * Get max size in bytes
   */
  get maxSize(): number {
    return DEFAULT_MAX_CACHE_SIZE_BYTES;
  }

  /**
   * Iterate over cache keys
   */
  keys(): Generator<string> {
    return this.cache.keys();
  }

  /**
   * Iterate over cache entries
   */
  entries(): Generator<[string, FileState]> {
    return (function* (this: FileStateCache) {
      for (const [key, entry] of this.cache) {
        yield [
          key,
          {
            content: entry.content,
            timestamp: entry.timestamp,
            offset: entry.offset,
            limit: entry.limit,
            isPartialView: entry.isPartialView,
            hash: entry.hash,
            size: entry.size,
            mtime: entry.mtime,
          },
        ];
      }
    }.bind(this))();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; avgAge: number; totalBytes: number } {
    const now = Date.now();
    let totalAge = 0;

    for (const entry of this.cache.values()) {
      totalAge += now - entry.timestamp;
    }

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      avgAge: this.cache.size > 0 ? totalAge / this.cache.size : 0,
      totalBytes: this.totalSize,
    };
  }

  /**
   * Evict oldest entries if cache exceeds max size or max age
   */
  private evictIfNeeded(): void {
    while (this.cache.size >= this.config.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        const entry = this.cache.get(oldest);
        if (entry) {
          this.totalSize -= Buffer.byteLength(entry.content, 'utf-8');
        }
        this.cache.delete(oldest);
      }
    }

    while (this.totalSize > DEFAULT_MAX_CACHE_SIZE_BYTES && this.cache.size > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        const entry = this.cache.get(oldest);
        if (entry) {
          this.totalSize -= Buffer.byteLength(entry.content, 'utf-8');
        }
        this.cache.delete(oldest);
      }
    }
  }

  /**
   * Update access order for LRU
   */
  private updateAccessOrder(key: string): void {
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.push(key);
  }

  /**
   * Get file stat safely
   */
  private getFileStat(filePath: string): { mtimeMs: number; size: number } {
    try {
      const stat = fs.statSync(filePath);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return { mtimeMs: 0, size: 0 };
    }
  }
}

const globalFileStateCache = new FileStateCache();

export const fileStateCache = globalFileStateCache;

/**
 * Get file state from global cache
 */
export function getFileState(filePath: string): FileState | null {
  return fileStateCache.get(filePath);
}

/**
 * Set file state in global cache
 */
export function setFileState(filePath: string, state: Partial<FileState>): void {
  fileStateCache.set(filePath, state);
}

/**
 * Invalidate file state in global cache
 */
export function invalidateFileState(filePath: string): void {
  fileStateCache.delete(filePath);
}

/**
 * Clear global file state cache
 */
export function clearFileStateCache(): void {
  fileStateCache.clear();
}

/**
 * Create a new file state cache instance
 */
export function createFileStateCache(config?: Partial<FileStateCacheConfig>): FileStateCache {
  return new FileStateCache(config);
}

/**
 * Clone a file state cache
 */
export function cloneFileStateCache(source: FileStateCache): FileStateCache {
  const cloned = new FileStateCache({
    maxSize: source.max,
    maxAge: 60000,
    hashContent: true,
  });

  for (const [key, state] of source.entries()) {
    cloned.set(key, state);
  }

  return cloned;
}

/**
 * Convert cache to object
 */
export function cacheToObject(cache: FileStateCache): Record<string, FileState> {
  return Object.fromEntries(cache.entries());
}

/**
 * Get all keys from cache
 */
export function cacheKeys(cache: FileStateCache): string[] {
  return Array.from(cache.keys());
}

export default FileStateCache;