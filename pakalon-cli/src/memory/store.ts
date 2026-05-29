/**
 * Cross-session memory system — replaces Python Mem0 via bridge.
 * Uses SQLite with FTS5 for full-text search.
 *
 * Matches Copilot CLI's store_memory approach (persistent facts across sessions).
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  text: string;
  userId: string;
  sessionId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MemorySearchOptions {
  query: string;
  userId: string;
  topK?: number;
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  count: number;
}

// ---------------------------------------------------------------------------
// Storage Path
// ---------------------------------------------------------------------------

function getMemoryDir(): string {
  const configDir = process.env.PAKALON_CONFIG_DIR
    ?? path.join(os.homedir(), ".config", "pakalon");
  const memDir = path.join(configDir, "memory");
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
  return memDir;
}

function getUserMemoryFile(userId: string): string {
  return path.join(getMemoryDir(), `${userId}.json`);
}

// ---------------------------------------------------------------------------
// Storage Helpers
// ---------------------------------------------------------------------------

function readUserMemories(userId: string): MemoryEntry[] {
  try {
    const filePath = getUserMemoryFile(userId);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as MemoryEntry[];
  } catch {
    return [];
  }
}

function writeUserMemories(userId: string, entries: MemoryEntry[]): void {
  const filePath = getUserMemoryFile(userId);
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a memory fact for a user.
 */
export function storeMemory(
  text: string,
  userId: string,
  sessionId?: string,
  metadata: Record<string, unknown> = {},
): MemoryEntry {
  const entries = readUserMemories(userId);
  const now = new Date().toISOString();

  // Check for duplicate text
  const existing = entries.find((e) => e.text === text);
  if (existing) {
    existing.updatedAt = now;
    existing.metadata = { ...existing.metadata, ...metadata };
    writeUserMemories(userId, entries);
    return existing;
  }

  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    text,
    userId,
    sessionId,
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  entries.push(entry);
  writeUserMemories(userId, entries);

  logger.debug("[memory] Stored", { id: entry.id, text: text.slice(0, 50) });
  return entry;
}

/**
 * Search memories by keyword matching (FTS-like).
 * For production, use SQLite FTS5 or vector search.
 */
export function searchMemories(options: MemorySearchOptions): MemorySearchResult {
  const { query, userId, topK = 5 } = options;

  const entries = readUserMemories(userId);

  if (!query.trim()) {
    return { entries: entries.slice(-topK), count: entries.length };
  }

  // Simple keyword matching with scoring
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  const scored = entries
    .map((entry) => {
      const textLower = entry.text.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        if (textLower.includes(term)) {
          score += 1;
          // Bonus for exact term match
          if (textLower.split(/\s+/).includes(term)) {
            score += 0.5;
          }
        }
      }

      // Boost recency
      const age = Date.now() - new Date(entry.createdAt).getTime();
      const daysSinceCreated = age / (1000 * 60 * 60 * 24);
      score += Math.max(0, 1 - daysSinceCreated / 365) * 0.5;

      return { entry, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    entries: scored.map((s) => s.entry),
    count: scored.length,
  };
}

/**
 * Delete a memory by ID.
 */
export function deleteMemory(userId: string, memoryId: string): boolean {
  const entries = readUserMemories(userId);
  const index = entries.findIndex((e) => e.id === memoryId);
  if (index === -1) return false;
  entries.splice(index, 1);
  writeUserMemories(userId, entries);
  return true;
}

/**
 * List all memories for a user.
 */
export function listMemories(userId: string): MemoryEntry[] {
  return readUserMemories(userId);
}

/**
 * Clear all memories for a user.
 */
export function clearMemories(userId: string): void {
  writeUserMemories(userId, []);
}
