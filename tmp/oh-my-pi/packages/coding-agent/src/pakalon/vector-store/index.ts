/**
 * Public surface for the vector-store RAG layer.
 *
 * Per CLI-req.md §215 (ChromaDB / LanceDB for attached-file RAG), this
 * module exposes a single import path for the bridge API.
 */
export * from "./bridge";
export * from "./embeddings";
