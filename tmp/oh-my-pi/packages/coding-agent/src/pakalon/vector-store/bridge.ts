/**
 * Bridge module for Pakalon's vector-store RAG layer.
 *
 * This is the public surface that the rest of the codebase (and the
 * registry-RAG fetcher + the attached-file tool) call. It hides the
 * backend selection behind two simple methods:
 *
 *   ingestAttachment(filePath, metadata)  -> VectorRecord count inserted
 *   retrieve(query, k, filter)            -> VectorMatch[]
 *
 * Per CLI-req.md §215, this layer lets attached files (PDFs, design
 * notes, references, screenshots) be embedded into the agent context
 * for grounded RAG during planning + development.
 *
 * Async file I/O via `node:fs/promises` (per AGENTS.md Bun rules).
 */
import * as crypto from "node:crypto";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { embedBatch } from "./embeddings";
import { getVectorStore } from "./lancedb-store";
import type { VectorMatch, VectorRecord } from "./types";

/** Default chunk size for text attachments. */
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;

/** Default upper bound on a single file to embed (avoids runaway token usage). */
const MAX_BYTES_PER_FILE = 256 * 1024;

/** Plain-text chunker. Splits on paragraph then sentence boundaries. */
function chunkText(text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
	const cleaned = text.replace(/\r\n/g, "\n").trim();
	if (cleaned.length === 0) return [];
	if (cleaned.length <= chunkSize) return [cleaned];
	const out: string[] = [];
	let i = 0;
	while (i < cleaned.length) {
		let end = Math.min(cleaned.length, i + chunkSize);
		if (end < cleaned.length) {
			// Snap to the nearest paragraph/sentence boundary in the last 25%.
			const boundary = findBoundary(cleaned, i + Math.floor(chunkSize * 0.75), end);
			end = boundary > i + 1 ? boundary : end;
		}
		out.push(cleaned.slice(i, end).trim());
		if (end >= cleaned.length) break;
		i = Math.max(end - overlap, i + 1);
	}
	return out.filter(c => c.length > 0);
}

function findBoundary(text: string, start: number, fallback: number): number {
	for (let i = fallback - 1; i > start; i--) {
		const ch = text[i];
		if (ch === "\n" || ch === "." || ch === "!" || ch === "?") return i + 1;
	}
	return fallback;
}

/** Deterministic id for a chunk, used to make upserts idempotent. */
function chunkId(source: string, chunkIndex: number): string {
	return crypto.createHash("sha1").update(`${source}|${chunkIndex}`).digest("hex").slice(0, 24);
}

const SUPPORTED_TEXT_EXT = new Set([
	".txt",
	".md",
	".json",
	".html",
	".htm",
	".csv",
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".rs",
	".go",
	".java",
	".rb",
	".yml",
	".yaml",
	".xml",
]);

/** Read a file as UTF-8 text. Binary files are sanitized to a whitespace placeholder. */
async function readAsText(file: string): Promise<string> {
	const ext = path.extname(file).toLowerCase();
	const buf = await fsPromises.readFile(file);
	const text = Buffer.from(buf).toString("utf8");
	if (!SUPPORTED_TEXT_EXT.has(ext)) {
		// Best-effort: strip control bytes that would confuse the embedder.
		return text.replace(/[\x00-\x08\x0E-\x1F]/g, " ");
	}
	return text;
}

export interface IngestAttachmentMeta {
	/** Stable source identifier (defaults to absolute file path). */
	source?: string;
	/** Free-form tags (project, phase, etc.). */
	tags?: string[];
	/** User id (for multi-tenant namespace separation). */
	userId?: string;
	/** Session id. */
	sessionId?: string;
}

/**
 * Embed and upsert a single attached file. Returns the number of chunks
 * inserted (0 if the file was unreadable / binary / over the size cap).
 */
export async function ingestAttachment(file: string, meta: IngestAttachmentMeta = {}): Promise<number> {
	let stat: fsPromises.Stats | undefined;
	try {
		stat = await fsPromises.stat(file);
	} catch (err) {
		logger.debug("vector-store: attachment not found", { file, err });
		return 0;
	}
	if (stat.size === 0 || stat.size > MAX_BYTES_PER_FILE) {
		logger.warn("vector-store: skipping oversized / empty attachment", { file, size: stat.size });
		return 0;
	}
	const text = await readAsText(file);
	if (text.length === 0) return 0;
	const chunks = chunkText(text);
	if (chunks.length === 0) return 0;
	const embeddings = await embedBatch(chunks);
	const source = meta.source ?? path.resolve(file);
	const records: VectorRecord[] = chunks.map((chunk, i) => ({
		id: chunkId(source, i),
		embedding: embeddings[i] ?? [],
		text: chunk,
		metadata: {
			source,
			filePath: file,
			chunkIndex: i,
			totalChunks: chunks.length,
			userId: meta.userId,
			sessionId: meta.sessionId,
			tags: meta.tags?.join(",") ?? "",
			ingestedAt: new Date().toISOString(),
		},
	}));
	const store = await getVectorStore(namespaceFor(meta));
	await store.upsert(records);
	await store.flush?.();
	logger.info("vector-store: attachment ingested", { file, chunks: records.length });
	return records.length;
}

/**
 * Embed a free-form query and return the top-K most-similar chunks.
 * Optionally filter by metadata (e.g. `tags === "phase-2"`).
 */
export async function retrieve(
	query: string,
	k = 8,
	filter?: Record<string, string | number | boolean>,
	meta: IngestAttachmentMeta = {},
): Promise<VectorMatch[]> {
	if (!query.trim()) return [];
	const embeddings = await embedBatch([query]);
	const embedding = embeddings[0];
	if (!embedding || embedding.length === 0) return [];
	const store = await getVectorStore(namespaceFor(meta));
	return store.query(embedding, k, filter);
}

/**
 * Ingest a list of files (e.g. the user's "attached" file list) and
 * return the total chunk count.
 */
export async function ingestAttachments(files: string[], meta: IngestAttachmentMeta = {}): Promise<number> {
	let total = 0;
	for (const f of files) {
		total += await ingestAttachment(f, meta);
	}
	return total;
}

/**
 * Compute the namespace key for a given user/project pair. Two users
 * with the same project name don't share an embedding space.
 */
function namespaceFor(meta: IngestAttachmentMeta): string {
	const uid = meta.userId ?? "default";
	const sid = meta.sessionId ?? "session";
	return `${uid}--${sid}`;
}

export type { StartVectorStoreOptions } from "./lancedb-store";
export { getVectorStore, startVectorStore } from "./lancedb-store";
/** Re-export the store interface so callers can manipulate the store directly if needed. */
export type { VectorMatch, VectorRecord, VectorStore } from "./types";
