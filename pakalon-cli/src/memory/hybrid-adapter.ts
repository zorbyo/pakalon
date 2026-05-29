import { randomUUID } from "crypto";
import logger from "@/utils/logger.js";
import {
  createMem0Client,
  type Mem0AddOptions,
  type Mem0Client,
  type Mem0GetAllOptions,
  type Mem0HistoryEntry,
  type Mem0Memory,
  type Mem0Message,
  type Mem0SearchOptions,
  type Mem0SearchResult,
  type Mem0UpdateData,
} from "@/memory/mem0-adapter.js";
import { createVectorStore, type ChromaVectorStore } from "./vector-store.js";

export interface HybridMem0Config {
  enableVectorSearch?: boolean;
  similarityThreshold?: number;
  vectorStore?: Parameters<typeof createVectorStore>[0];
  sqliteFallback?: boolean;
}

class HybridMem0Client implements Mem0Client {
  private readonly sqlite: Mem0Client;
  private readonly vectorStore: ChromaVectorStore | null;
  private readonly threshold: number;

  constructor(config: HybridMem0Config = {}) {
    this.sqlite = createMem0Client();
    this.vectorStore = config.enableVectorSearch === false ? null : createVectorStore({
      ...(config.vectorStore ?? {}),
      similarityThreshold: config.similarityThreshold,
    });
    this.threshold = config.similarityThreshold ?? config.vectorStore?.similarityThreshold ?? 0.75;
  }

  async add(messages: Mem0Message[], options?: Mem0AddOptions): Promise<Mem0Memory> {
    const memory = await this.sqlite.add(messages, options);
    if (this.vectorStore) {
      await this.vectorStore.upsert({
        id: memory.id,
        text: memory.content,
        userId: memory.userId,
        sessionId: memory.sessionId,
        metadata: memory.metadata,
      });
    }
    return memory;
  }

  async search(query: string, options?: Mem0SearchOptions): Promise<Mem0SearchResult[]> {
    const sqliteResults = await this.sqlite.search(query, options);
    if (!this.vectorStore) return sqliteResults;

    try {
      const vectorResults = await this.vectorStore.search(query, {
        userId: options?.userId,
        sessionId: options?.sessionId,
        limit: options?.limit ?? 10,
        threshold: this.threshold,
      });

      const merged = new Map<string, Mem0SearchResult>();
      for (const result of sqliteResults) merged.set(result.id, result);
      for (const result of vectorResults) {
        if (!merged.has(result.id)) {
          merged.set(result.id, {
            id: result.id,
            content: result.text,
            userId: result.userId,
            sessionId: result.sessionId,
            metadata: result.metadata ?? {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            score: result.score,
          });
        }
      }

      return Array.from(merged.values())
        .sort((left, right) => right.score - left.score)
        .slice(0, options?.limit ?? 10);
    } catch (error) {
      logger.warn(`[memory-hybrid] Vector search unavailable, using SQLite only: ${error}`);
      return sqliteResults;
    }
  }

  async get(memoryId: string): Promise<Mem0Memory | null> {
    return this.sqlite.get(memoryId);
  }

  async update(memoryId: string, data: Mem0UpdateData): Promise<Mem0Memory | null> {
    const updated = await this.sqlite.update(memoryId, data);
    if (updated && this.vectorStore) {
      await this.vectorStore.upsert({
        id: updated.id,
        text: updated.content,
        userId: updated.userId,
        sessionId: updated.sessionId,
        metadata: updated.metadata,
      });
    }
    return updated;
  }

  async delete(memoryId: string): Promise<boolean> {
    const deleted = await this.sqlite.delete(memoryId);
    if (deleted && this.vectorStore) {
      await this.vectorStore.delete(memoryId);
    }
    return deleted;
  }

  async history(memoryId: string): Promise<Mem0HistoryEntry[]> {
    return this.sqlite.history(memoryId);
  }

  async getAll(options?: Mem0GetAllOptions): Promise<Mem0Memory[]> {
    return this.sqlite.getAll(options);
  }
}

export function createHybridMem0Client(config?: HybridMem0Config): Mem0Client {
  try {
    return new HybridMem0Client(config);
  } catch (error) {
    logger.warn(`[memory-hybrid] Falling back to SQLite Mem0 client: ${error}`);
    return createMem0Client();
  }
}
