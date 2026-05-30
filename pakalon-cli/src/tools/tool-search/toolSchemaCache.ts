/**
 * Tool Schema Cache
 *
 * Caches tool JSON schemas for prompt cache optimization.
 * When tools are loaded repeatedly, caching their serialized schemas
 * avoids redundant serialization and enables prompt cache hits.
 */

/**
 * Cache entry with metadata.
 */
interface CacheEntry {
  schema: string;
  tokenEstimate: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  totalTokenEstimate: number;
}

/**
 * Tool schema cache with LRU eviction and TTL expiration.
 */
export class ToolSchemaCache {
  private cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(options?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = options?.maxSize ?? 500;
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Cache a tool schema.
   */
  cacheSchema(toolName: string, schema: string): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(toolName)) {
      this.evictLRU();
    }

    const tokenEstimate = Math.ceil(schema.length / 4); // ~4 chars per token
    const now = Date.now();

    this.cache.set(toolName, {
      schema,
      tokenEstimate,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
    });
  }

  /**
   * Get a cached tool schema.
   */
  getCachedSchema(toolName: string): string | null {
    const entry = this.cache.get(toolName);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(toolName);
      this.misses++;
      return null;
    }

    // Update access metadata
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.hits++;

    return entry.schema;
  }

  /**
   * Check if a schema is cached.
   */
  has(toolName: string): boolean {
    const entry = this.cache.get(toolName);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(toolName);
      return false;
    }

    return true;
  }

  /**
   * Invalidate a cached schema.
   */
  invalidate(toolName: string): void {
    this.cache.delete(toolName);
  }

  /**
   * Invalidate all cached schemas.
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    let totalTokenEstimate = 0;
    for (const entry of this.cache.values()) {
      totalTokenEstimate += entry.tokenEstimate;
    }

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      totalTokenEstimate,
    };
  }

  /**
   * Evict the least recently used entry.
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// Singleton instance
let _instance: ToolSchemaCache | null = null;

/**
 * Get the global tool schema cache.
 */
export function getToolSchemaCache(): ToolSchemaCache {
  if (!_instance) {
    _instance = new ToolSchemaCache();
  }
  return _instance;
}

/**
 * Cache a tool schema using the global cache.
 */
export function cacheToolSchema(toolName: string, schema: string): void {
  getToolSchemaCache().cacheSchema(toolName, schema);
}

/**
 * Get a cached tool schema using the global cache.
 */
export function getCachedToolSchema(toolName: string): string | null {
  return getToolSchemaCache().getCachedSchema(toolName);
}
