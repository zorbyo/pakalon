/**
 * Memory key-value store — replaces Python bridge /memory/set and /memory/get.
 * Stores data in ~/.config/pakalon/kv.json.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Storage path
// ---------------------------------------------------------------------------

function getKvStorePath(): string {
  const configDir = process.env.PAKALON_CONFIG_DIR
    ?? path.join(os.homedir(), ".config", "pakalon");
  return path.join(configDir, "kv.json");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KvStore {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Read/Write
// ---------------------------------------------------------------------------

function readStore(): KvStore {
  try {
    const storePath = getKvStorePath();
    if (!fs.existsSync(storePath)) return {};
    const raw = fs.readFileSync(storePath, "utf-8");
    return JSON.parse(raw) as KvStore;
  } catch {
    return {};
  }
}

function writeStore(store: KvStore): void {
  try {
    const storePath = getKvStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    logger.error("[kv-store] Failed to write", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a value from the KV store.
 */
export function kvGet(key: string): unknown {
  const store = readStore();
  return store[key];
}

/**
 * Set a value in the KV store.
 */
export function kvSet(key: string, value: unknown): void {
  const store = readStore();
  store[key] = value;
  writeStore(store);
}

/**
 * Delete a key from the KV store.
 */
export function kvDelete(key: string): boolean {
  const store = readStore();
  if (!(key in store)) return false;
  delete store[key];
  writeStore(store);
  return true;
}

/**
 * List all keys in the KV store.
 */
export function kvList(): string[] {
  return Object.keys(readStore());
}

/**
 * Check if a key exists in the KV store.
 */
export function kvHas(key: string): boolean {
  return key in readStore();
}

/**
 * Clear all entries in the KV store.
 */
export function kvClear(): void {
  writeStore({});
}
