# vector_rag

> Query the Pakalon vector-store layer for attached-file context. Used for grounded RAG over user-supplied files (PDFs, design notes, references, screenshots).

## Source

- Entry: `packages/coding-agent/src/tools/vector-rag.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/vector-rag.md`
- Bridge: `packages/coding-agent/src/pakalon/vector-store/bridge.ts`
- Embeddings: `packages/coding-agent/src/pakalon/vector-store/embeddings.ts` (fastembed `BGESmallEN` + hash fallback)
- Backends:
  - `MemoryVectorStore` (default, JSON-backed) — `vector-store/memory-store.ts`
  - `LanceDBVectorStore` — `vector-store/lancedb-store.ts` (activates when `lancedb` is installed)

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | `string` | Yes | Natural-language query to find the most relevant chunks. |
| `k` | `number` | No | Number of chunks to return (default 8, max 50). |
| `filter` | `Record<string, string \| number \| boolean>` | No | Metadata filter (e.g. `{ tags: "phase-2" }`). |
| `attach` | `string[]` | No | Optional list of files to ingest before querying. |

## Outputs

- `content[0].text` is one block per match, formatted as `[N] source  score=X.XXX\n<chunk text>`.
- `details.ingested`: number of chunks written for any `attach[]` files.
- `details.matches`: number of top-K results returned.
- `details.topScore`: highest cosine similarity in the result set.

## When to use

- The user attached a PDF / design note / reference site and you need to ground your answer in that content.
- During Phase 1 / Phase 3, you want to recall earlier context from prior session attachments.

## Notes

- Embeddings are deterministic; results are reproducible across runs.
- Files over 256 KB are skipped (configurable via `MAX_BYTES_PER_FILE`).
- The `tags` filter accepts comma-separated strings set during ingest.
