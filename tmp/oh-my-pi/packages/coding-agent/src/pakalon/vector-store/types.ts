/**
 * Vector store types for Pakalon's attached-file RAG layer.
 *
 * Per CLI-req.md §215:
 *   "using the chromaDb and Lnace DB using these 2 the import or the file
 *    attached the AI agents must get the information from those and imbed
 *    it to the AI agents and then start working on the application."
 *
 * This module ships two backends behind a common `VectorStore` interface:
 *   1. `MemoryVectorStore` — in-process + JSON persistence; default backend,
 *      works offline with no external dependency.
 *   2. `LanceDBVectorStore` — activates when `lancedb` is installed; mirrors
 *      the same interface so callers are unaffected by the swap.
 *
 * Embeddings are produced by `fastembed` (`BGESmallEN`, ~33MB model
 * cached after first download). The store is chunked-aware so the
 * `retrieve()` API returns the top-K most-similar chunks, not whole files.
 */
export interface VectorRecord {
	/** Stable id (typically `sha1(filePath + chunkIndex)`). */
	id: string;
	/** Embedding vector (typically 384-dim for BGE-small-en). */
	embedding: number[];
	/** The text chunk that was embedded. */
	text: string;
	/** Source metadata: file path, chunk index, project, session, etc. */
	metadata: Record<string, unknown>;
}

export interface VectorMatch {
	id: string;
	/** Cosine similarity in [-1, 1]. */
	score: number;
	text: string;
	metadata: Record<string, unknown>;
}

/** Optional metadata filter applied at query time (exact-match on top-level keys). */
export type VectorFilter = Record<string, string | number | boolean>;

export interface VectorStore {
	/** Insert or update records. Duplicates by `id` are replaced. */
	upsert(records: VectorRecord[]): Promise<void>;
	/** Top-K most-similar records, ordered by descending score. */
	query(embedding: number[], k: number, filter?: VectorFilter): Promise<VectorMatch[]>;
	/** Total record count. */
	count(): Promise<number>;
	/** Persist to disk if the backend supports it. No-op otherwise. */
	flush?(): Promise<void>;
	/** Release any resources (file handles, native handles). */
	close(): Promise<void>;
}
