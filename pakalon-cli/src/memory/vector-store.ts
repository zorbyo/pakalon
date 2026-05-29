import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import logger from "@/utils/logger.js";

export interface VectorMemoryRecord {
  id: string;
  text: string;
  userId: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchHit extends VectorMemoryRecord {
  score: number;
}

export interface VectorStoreConfig {
  persistPath?: string;
  collectionName?: string;
  similarityThreshold?: number;
  embeddingProvider?: "local" | "openai";
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
}

type ChromaClient = any;
type ChromaCollection = any;

const DEFAULT_CHROMA_DIR = path.join(
  process.env.PAKALON_CONFIG_DIR ?? path.join(os.homedir(), ".config", "pakalon"),
  "memory",
  "chroma",
);

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashEmbedding(text: string, dimensions = 384): number[] {
  const vector = new Array(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    const index = Math.abs(hash) % dimensions;
    vector[index] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

async function computeEmbedding(text: string, config: VectorStoreConfig): Promise<number[]> {
  const provider = config.embeddingProvider ?? (process.env.OPENAI_API_KEY ? "openai" : "local");

  if (provider === "openai" && (config.openaiApiKey ?? process.env.OPENAI_API_KEY)) {
    try {
      const apiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "";
      const baseUrl = config.openaiBaseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
      const model = config.openaiModel ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: text }),
      });

      if (response.ok) {
        const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
        const embedding = payload.data?.[0]?.embedding;
        if (Array.isArray(embedding) && embedding.length > 0) {
          return embedding;
        }
      }
    } catch (error) {
      logger.warn(`[memory-vector] OpenAI embedding failed, using local fallback: ${error}`);
    }
  }

  return hashEmbedding(text);
}

export class ChromaVectorStore {
  private readonly config: VectorStoreConfig;
  private client: ChromaClient | null = null;
  private collection: ChromaCollection | null = null;
  private readonly ready: Promise<void>;

  constructor(config: VectorStoreConfig = {}) {
    this.config = config;
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    const persistPath = this.config.persistPath ?? DEFAULT_CHROMA_DIR;
    ensureDir(persistPath);

    try {
      const chromadb = await import("chromadb") as any;
      const ChromaClientCtor = chromadb.ChromaClient;
      if (!ChromaClientCtor) {
        throw new Error("Chroma client not available");
      }

      const client = new ChromaClientCtor({ path: persistPath });

      this.client = client;
      this.collection = await client.getOrCreateCollection({
        name: this.config.collectionName ?? "pakalon_memories",
      });
      logger.info("[memory-vector] ChromaDB vector store initialized");
    } catch (error) {
      logger.warn(`[memory-vector] ChromaDB unavailable, semantic search will fallback: ${error}`);
      this.client = null;
      this.collection = null;
    }
  }

  private async ensureReady(): Promise<boolean> {
    await this.ready;
    return Boolean(this.collection);
  }

  async upsert(record: VectorMemoryRecord): Promise<boolean> {
    if (!(await this.ensureReady()) || !this.collection) return false;

    try {
      const text = record.text;
      const embedding = await computeEmbedding(text, this.config);
      await this.collection.upsert({
        ids: [record.id],
        documents: [text],
        embeddings: [embedding],
        metadatas: [
          {
            userId: record.userId,
            sessionId: record.sessionId ?? null,
            ...(record.metadata ?? {}),
          },
        ],
      });
      return true;
    } catch (error) {
      logger.warn(`[memory-vector] Failed to upsert vector record: ${error}`);
      return false;
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.ensureReady()) || !this.collection) return false;
    try {
      await this.collection.delete({ ids: [id] });
      return true;
    } catch (error) {
      logger.warn(`[memory-vector] Failed to delete vector record: ${error}`);
      return false;
    }
  }

  async search(query: string, options: { userId?: string; sessionId?: string; limit?: number; threshold?: number } = {}): Promise<VectorSearchHit[]> {
    if (!(await this.ensureReady()) || !this.collection) return [];

    try {
      const queryEmbedding = await computeEmbedding(query, this.config);
      const result = await this.collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: options.limit ?? 10,
        where: {
          ...(options.userId ? { userId: options.userId } : {}),
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        },
      });

      const ids = result.ids?.[0] ?? [];
      const documents = result.documents?.[0] ?? [];
      const metadatas = result.metadatas?.[0] ?? [];
      const distances = result.distances?.[0] ?? [];
      const threshold = options.threshold ?? this.config.similarityThreshold ?? 0.75;

      return ids
        .map((id: string, index: number) => {
          const distance = Number(distances[index] ?? 1);
          const score = 1 - distance;
          if (score < threshold) return null;

          const metadata = metadatas[index] ?? {};
          return {
            id,
            text: String(documents[index] ?? ""),
            userId: String(metadata.userId ?? options.userId ?? "anonymous"),
            sessionId: typeof metadata.sessionId === "string" ? metadata.sessionId : options.sessionId,
            metadata: metadata as Record<string, unknown>,
            score,
          } satisfies VectorSearchHit;
        })
        .filter((value: VectorSearchHit | null): value is VectorSearchHit => Boolean(value));
    } catch (error) {
      logger.warn(`[memory-vector] Vector search failed: ${error}`);
      return [];
    }
  }

  async similarity(a: string, b: string): Promise<number> {
    const [embeddingA, embeddingB] = await Promise.all([
      computeEmbedding(a, this.config),
      computeEmbedding(b, this.config),
    ]);
    return cosineSimilarity(embeddingA, embeddingB);
  }
}

export function createVectorStore(config?: VectorStoreConfig): ChromaVectorStore {
  return new ChromaVectorStore(config);
}
