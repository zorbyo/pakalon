/**
 * Tool Result Storage
 *
 * Manages storage and retrieval of tool results for content replacement
 * and budget management.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '@/utils/logger.js';

export interface ToolResultEntry {
  id: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  resultText: string;
  tokenCount: number;
  createdAt: number;
  accessedAt: number;
  expiresAt?: number;
}

export interface ContentReplacement {
  originalText: string;
  replacementText: string;
  toolUseId: string;
}

export interface ToolResultStorageConfig {
  maxEntries?: number;
  maxTokenBudget?: number;
  maxAgeMs?: number;
  persistToDisk?: boolean;
  storageDir?: string;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_TOKEN_BUDGET = 500000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

class ToolResultStorageManager {
  private entries: Map<string, ToolResultEntry> = new Map();
  private contentReplacements: Map<string, ContentReplacement> = new Map();
  private config: Required<ToolResultStorageConfig>;
  private totalTokens = 0;

  constructor(config: ToolResultStorageConfig = {}) {
    this.config = {
      maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxTokenBudget: config.maxTokenBudget ?? DEFAULT_MAX_TOKEN_BUDGET,
      maxAgeMs: config.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      persistToDisk: config.persistToDisk ?? false,
      storageDir: config.storageDir ?? '.pakalon-tool-results',
    };
  }

  store(
    toolUseId: string,
    toolName: string,
    result: unknown,
  ): string {
    const id = randomUUID();
    const resultText = this.serializeResult(result);
    const tokenCount = this.estimateTokens(resultText);

    const entry: ToolResultEntry = {
      id,
      toolUseId,
      toolName,
      result,
      resultText,
      tokenCount,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      expiresAt: Date.now() + this.config.maxAgeMs,
    };

    this.entries.set(toolUseId, entry);
    this.totalTokens += tokenCount;

    this.enforceBudget();

    if (this.config.persistToDisk) {
      this.persistEntry(entry).catch(err => {
        logger.error(`[ToolResultStorage] Failed to persist: ${err}`);
      });
    }

    logger.debug(`[ToolResultStorage] Stored result for ${toolName} (${tokenCount} tokens)`);

    return id;
  }

  get(toolUseId: string): ToolResultEntry | undefined {
    const entry = this.entries.get(toolUseId);
    if (entry) {
      entry.accessedAt = Date.now();
    }
    return entry;
  }

  getResult(toolUseId: string): unknown {
    const entry = this.get(toolUseId);
    return entry?.result;
  }

  getResultText(toolUseId: string): string | undefined {
    const entry = this.get(toolUseId);
    return entry?.resultText;
  }

  addContentReplacement(replacement: ContentReplacement): void {
    this.contentReplacements.set(replacement.originalText, replacement);
    logger.debug(`[ToolResultStorage] Added content replacement for ${replacement.toolUseId}`);
  }

  getReplacements(): ContentReplacement[] {
    return Array.from(this.contentReplacements.values());
  }

  applyReplacements(text: string): string {
    let result = text;
    for (const [original, replacement] of this.contentReplacements) {
      result = result.replace(original, replacement.replacementText);
    }
    return result;
  }

  private serializeResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result, null, 2);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private enforceBudget(): void {
    while (
      (this.entries.size > this.config.maxEntries || this.totalTokens > this.config.maxTokenBudget) &&
      this.entries.size > 0
    ) {
      let oldestEntry: ToolResultEntry | null = null;
      let oldestTime = Infinity;

      for (const entry of this.entries.values()) {
        if (entry.accessedAt < oldestTime) {
          oldestTime = entry.accessedAt;
          oldestEntry = entry;
        }
      }

      if (oldestEntry) {
        this.remove(oldestEntry.toolUseId);
      }
    }
  }

  remove(toolUseId: string): boolean {
    const entry = this.entries.get(toolUseId);
    if (entry) {
      this.totalTokens -= entry.tokenCount;
      this.entries.delete(toolUseId);

      for (const [original, replacement] of this.contentReplacements) {
        if (replacement.toolUseId === toolUseId) {
          this.contentReplacements.delete(original);
        }
      }

      if (this.config.persistToDisk) {
        this.deleteEntry(toolUseId).catch(err => {
          logger.error(`[ToolResultStorage] Failed to delete: ${err}`);
        });
      }

      return true;
    }
    return false;
  }

  clear(): void {
    this.entries.clear();
    this.contentReplacements.clear();
    this.totalTokens = 0;
    logger.debug('[ToolResultStorage] Cleared all entries');
  }

  cleanup(): void {
    const now = Date.now();
    for (const [toolUseId, entry] of this.entries) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.remove(toolUseId);
      }
    }
  }

  getStats(): {
    entryCount: number;
    totalTokens: number;
    byTool: Record<string, number>;
  } {
    const byTool: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      byTool[entry.toolName] = (byTool[entry.toolName] ?? 0) + 1;
    }

    return {
      entryCount: this.entries.size,
      totalTokens: this.totalTokens,
      byTool,
    };
  }

  private async persistEntry(entry: ToolResultEntry): Promise<void> {
    const storagePath = this.getStoragePath(entry.toolUseId);
    await fs.writeFile(storagePath, JSON.stringify(entry), 'utf-8');
  }

  private async deleteEntry(toolUseId: string): Promise<void> {
    const storagePath = this.getStoragePath(toolUseId);
    try {
      await fs.unlink(storagePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  private getStoragePath(toolUseId: string): string {
    return path.join(this.config.storageDir, `${toolUseId}.json`);
  }
}

const globalStorage = new ToolResultStorageManager();

export function getToolResultStorage(): ToolResultStorageManager {
  return globalStorage;
}

export function createToolResultStorage(config?: ToolResultStorageConfig): ToolResultStorageManager {
  return new ToolResultStorageManager(config);
}

export function storeToolResult(
  toolUseId: string,
  toolName: string,
  result: unknown,
): string {
  return globalStorage.store(toolUseId, toolName, result);
}

export function getToolResult(toolUseId: string): unknown {
  return globalStorage.getResult(toolUseId);
}

export function applyToolResultBudget(
  messages: Array<{ content: unknown }>,
  maxTokens: number,
): Array<{ content: unknown }> {
  const replacements = globalStorage.getReplacements();

  if (replacements.length === 0) {
    return messages;
  }

  return messages.map(msg => {
    let content = msg.content;
    if (typeof content === 'string') {
      content = globalStorage.applyReplacements(content);
    } else if (Array.isArray(content)) {
      content = content.map(block => {
        if (block.type === 'text' && typeof block.text === 'string') {
          return { ...block, text: globalStorage.applyReplacements(block.text) };
        }
        return block;
      });
    }
    return { ...msg, content };
  });
}

export function recordContentReplacement(
  toolUseId: string,
  originalText: string,
  replacementText: string,
): void {
  globalStorage.addContentReplacement({
    originalText,
    replacementText,
    toolUseId,
  });
}

export { ToolResultStorageManager };
export type { ToolResultEntry, ContentReplacement, ToolResultStorageConfig };