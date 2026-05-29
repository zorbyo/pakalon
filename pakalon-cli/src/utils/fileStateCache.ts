import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import logger from '@/utils/logger.js';

export interface FileState {
  path: string;
  hash: string;
  size: number;
  mtime: number;
  content?: string;
  diagnostics?: unknown[];
  lastRead?: number;
}

export interface FileStateCacheConfig {
  maxSize: number;
  maxAge: number;
  hashContent: boolean;
}

const DEFAULT_CACHE_CONFIG: FileStateCacheConfig = {
  maxSize: 1000,
  maxAge: 60000,
  hashContent: true,
};

class FileStateCache {
  private cache: Map<string, FileState> = new Map();
  private accessOrder: string[] = [];
  private config: FileStateCacheConfig;

  constructor(config: Partial<FileStateCacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  private getFileHash(filePath: string, content?: string): string {
    if (!this.config.hashContent) {
      return '';
    }

    try {
      const stat = fs.statSync(filePath);
      const hashInput = content || `${filePath}-${stat.mtimeMs}-${stat.size}`;
      return crypto.createHash('md5').update(hashInput).digest('hex');
    } catch {
      return '';
    }
  }

  get(filePath: string): FileState | null {
    const normalized = path.normalize(filePath);
    const state = this.cache.get(normalized);

    if (!state) {
      return null;
    }

    if (Date.now() - state.mtime > this.config.maxAge) {
      this.cache.delete(normalized);
      return null;
    }

    this.updateAccessOrder(normalized);

    return state;
  }

  set(filePath: string, state: Partial<FileState>): void {
    const normalized = path.normalize(filePath);

    try {
      const stat = fs.statSync(normalized);
      const fullState: FileState = {
        path: normalized,
        hash: state.hash || this.getFileHash(normalized, state.content),
        size: stat.size,
        mtime: stat.mtimeMs,
        lastRead: Date.now(),
        ...state,
      };

      this.evictIfNeeded();

      this.cache.set(normalized, fullState);
      this.updateAccessOrder(normalized);
    } catch (err) {
      logger.warn(`Failed to cache file state for ${filePath}:`, err);
    }
  }

  invalidate(filePath: string): void {
    const normalized = path.normalize(filePath);
    this.cache.delete(normalized);
    this.accessOrder = this.accessOrder.filter((p) => p !== normalized);
  }

  invalidateDir(dirPath: string): void {
    const normalized = path.normalize(dirPath);
    const toDelete: string[] = [];

    for (const filePath of this.cache.keys()) {
      if (filePath.startsWith(normalized)) {
        toDelete.push(filePath);
      }
    }

    for (const filePath of toDelete) {
      this.cache.delete(filePath);
      this.accessOrder = this.accessOrder.filter((p) => p !== filePath);
    }
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.config.maxSize) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }
  }

  private updateAccessOrder(filePath: string): void {
    this.accessOrder = this.accessOrder.filter((p) => p !== filePath);
    this.accessOrder.push(filePath);
  }

  size(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  getStats(): {
    size: number;
    maxSize: number;
    avgAge: number;
  } {
    const now = Date.now();
    let totalAge = 0;

    for (const state of this.cache.values()) {
      totalAge += now - state.mtime;
    }

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      avgAge: this.cache.size > 0 ? totalAge / this.cache.size : 0,
    };
  }
}

export const fileStateCache = new FileStateCache();

export function getFileState(filePath: string): FileState | null {
  return fileStateCache.get(filePath);
}

export function setFileState(filePath: string, state: Partial<FileState>): void {
  fileStateCache.set(filePath, state);
}

export function invalidateFileState(filePath: string): void {
  fileStateCache.invalidate(filePath);
}

export function clearFileStateCache(): void {
  fileStateCache.clear();
}

export function createFileStateCache(config?: Partial<FileStateCacheConfig>): FileStateCache {
  return new FileStateCache(config);
}

export { FileStateCache };