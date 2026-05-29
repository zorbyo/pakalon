/**
 * Bridge Client — Pure TypeScript replacement for Python bridge communication.
 *
 * This module provides the client-side API for bridge operations.
 * Since the Python bridge is no longer required (see bridge/index.ts comment),
 * this implements local memory search using the built-in memory store.
 */

import { searchMemories, type MemorySearchOptions } from "@/memory/store.js";
import type { MemorySearchPayload, MemorySearchResult } from "./types.js";

/**
 * Bridge-aware memory search.
 * Routes to local memory store (replaces Python Mem0 via bridge).
 */
export async function bridgeMemorySearch(
  payload: MemorySearchPayload,
): Promise<MemorySearchResult> {
  const { query, user_id, top_k = 5 } = payload;

  const options: MemorySearchOptions = {
    query,
    userId: user_id,
    topK: top_k,
  };

  const result = searchMemories(options);

  // Convert from internal format to bridge format
  return {
    memories: result.entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      score: 1.0, // score already factored into ordering
      metadata: entry.metadata,
    })),
  };
}

/**
 * Ping the bridge (health check).
 * Returns true if bridge is responsive.
 */
export async function bridgePing(): Promise<boolean> {
  // Local bridge is always available since we use direct TypeScript
  return true;
}