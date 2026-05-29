/**
 * Team Memory Sync
 * 
 * Provides cross-team memory sharing and synchronization:
 * - Shared memory pools between teams
 * - Memory replication across agent instances
 * - Conflict resolution for concurrent writes
 * - Memory persistence and recovery
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

export interface TeamMemoryEntry {
  id: string;
  teamId: string;
  agentId?: string;
  key: string;
  value: unknown;
  timestamp: number;
  version: number;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySyncConfig {
  enabled: boolean;
  syncIntervalMs: number;
  persistencePath: string;
  maxMemorySize: number;
  conflictResolution: "last-write-wins" | "merge" | "agent-priority";
}

const DEFAULT_CONFIG: MemorySyncConfig = {
  enabled: false,
  syncIntervalMs: 30000,
  persistencePath: "",
  maxMemorySize: 10000,
  conflictResolution: "last-write-wins",
};

const MEMORY_ENTRY_SCHEMA = z.object({
  id: z.string(),
  teamId: z.string(),
  agentId: z.string().optional(),
  key: z.string(),
  value: z.unknown(),
  timestamp: z.number(),
  version: z.number(),
  ttl: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export class TeamMemorySync extends EventEmitter {
  private config: MemorySyncConfig;
  private memory: Map<string, TeamMemoryEntry> = new Map();
  private pendingWrites: Map<string, TeamMemoryEntry> = new Map();
  private syncHandle: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(entry: TeamMemoryEntry, event: "created" | "updated" | "deleted") => void> = new Set();

  constructor(config?: Partial<MemorySyncConfig>) {
    super();
    const persistencePath = config?.persistencePath || join(process.cwd(), ".pakalon", "team-memory");
    this.config = { ...DEFAULT_CONFIG, ...config, persistencePath };
    this.loadFromDisk();
  }

  private getStoragePath(): string {
    return join(this.config.persistencePath, "team-memory.json");
  }

  private loadFromDisk(): void {
    const path = this.getStoragePath();
    if (!existsSync(path)) return;

    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw) as TeamMemoryEntry[];
      
      for (const entry of data) {
        const validation = MEMORY_ENTRY_SCHEMA.safeParse(entry);
        if (validation.success) {
          this.memory.set(entry.id, validation.data);
        }
      }
      
      logger.debug(`[TeamMemory] Loaded ${this.memory.size} entries from disk`);
    } catch (err) {
      logger.warn("[TeamMemory] Failed to load from disk:", err);
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.getStoragePath());
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      const data = Array.from(this.memory.values());
      writeFileSync(this.getStoragePath(), JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      logger.error("[TeamMemory] Failed to save to disk:", err);
    }
  }

  start(): void {
    if (this.syncHandle) return;

    this.syncHandle = setInterval(() => {
      this.flushWrites();
      this.emit("sync");
    }, this.config.syncIntervalMs);

    logger.info("[TeamMemory] Started memory sync");
  }

  stop(): void {
    if (this.syncHandle) {
      clearInterval(this.syncHandle);
      this.syncHandle = null;
    }
    this.flushWrites();
    this.saveToDisk();
    logger.info("[TeamMemory] Stopped memory sync");
  }

  async set(
    teamId: string,
    key: string,
    value: unknown,
    options?: { agentId?: string; ttl?: number; metadata?: Record<string, unknown> }
  ): Promise<TeamMemoryEntry> {
    const existing = Array.from(this.memory.values()).find(
      (e) => e.teamId === teamId && e.key === key
    );

    const entry: TeamMemoryEntry = {
      id: existing?.id || `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      teamId,
      agentId: options?.agentId,
      key,
      value,
      timestamp: Date.now(),
      version: (existing?.version || 0) + 1,
      ttl: options?.ttl ? Date.now() + options.ttl : undefined,
      metadata: options?.metadata,
    };

    this.memory.set(entry.id, entry);
    this.pendingWrites.set(entry.id, entry);
    this.emit("entry:updated", entry);

    for (const listener of this.listeners) {
      try {
        listener(entry, existing ? "updated" : "created");
      } catch {
        // Ignore listener errors
      }
    }

    return entry;
  }

  get(teamId: string, key: string): TeamMemoryEntry | undefined {
    const entry = Array.from(this.memory.values()).find(
      (e) => e.teamId === teamId && e.key === key
    );

    if (!entry) return undefined;

    if (entry.ttl && Date.now() > entry.ttl) {
      this.delete(teamId, key);
      return undefined;
    }

    return entry;
  }

  getAll(teamId: string): TeamMemoryEntry[] {
    return Array.from(this.memory.values())
      .filter((e) => e.teamId === teamId)
      .filter((e) => !e.ttl || Date.now() <= e.ttl);
  }

  getByAgent(teamId: string, agentId: string): TeamMemoryEntry[] {
    return this.getAll(teamId).filter((e) => e.agentId === agentId);
  }

  delete(teamId: string, key: string): boolean {
    const entry = this.get(teamId, key);
    if (!entry) return false;

    this.memory.delete(entry.id);
    this.emit("entry:deleted", entry);
    return true;
  }

  clear(teamId: string): number {
    const entries = this.getAll(teamId);
    for (const entry of entries) {
      this.memory.delete(entry.id);
    }
    this.emit("team:cleared", teamId);
    return entries.length;
  }

  search(teamId: string, query: string): TeamMemoryEntry[] {
    const q = query.toLowerCase();
    return this.getAll(teamId).filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        JSON.stringify(e.value).toLowerCase().includes(q)
    );
  }

  subscribe(
    callback: (entry: TeamMemoryEntry, event: "created" | "updated" | "deleted") => void
  ): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private flushWrites(): void {
    if (this.pendingWrites.size === 0) return;

    for (const entry of this.pendingWrites.values()) {
      this.memory.set(entry.id, entry);
    }

    this.pendingWrites.clear();
    this.saveToDisk();
  }

  getStats(teamId?: string): {
    totalEntries: number;
    teamEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = teamId ? this.getAll(teamId) : Array.from(this.memory.values());
    const timestamps = entries.map((e) => e.timestamp).sort((a, b) => a - b);

    return {
      totalEntries: teamId ? this.getAll(teamId).length : this.memory.size,
      teamEntries: entries.length,
      oldestEntry: timestamps[0] || null,
      newestEntry: timestamps[timestamps.length - 1] || null,
    };
  }

  mergeFromRemote(entries: TeamMemoryEntry[]): number {
    let merged = 0;

    for (const remoteEntry of entries) {
      const local = this.memory.get(remoteEntry.id);

      if (!local) {
        this.memory.set(remoteEntry.id, remoteEntry);
        merged++;
      } else if (this.config.conflictResolution === "last-write-wins") {
        if (remoteEntry.timestamp > local.timestamp) {
          this.memory.set(remoteEntry.id, remoteEntry);
          merged++;
        }
      } else if (this.config.conflictResolution === "merge") {
        if (remoteEntry.version > local.version) {
          this.memory.set(remoteEntry.id, remoteEntry);
          merged++;
        }
      }
    }

    if (merged > 0) {
      this.saveToDisk();
      this.emit("sync:merged", merged);
    }

    return merged;
  }

  exportForSync(): TeamMemoryEntry[] {
    return Array.from(this.memory.values());
  }

  setConfig(updates: Partial<MemorySyncConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...updates };

    if (this.config.enabled && !wasEnabled) {
      this.start();
    } else if (!this.config.enabled && wasEnabled) {
      this.stop();
    }
  }

  getConfig(): MemorySyncConfig {
    return this.config;
  }
}

let memorySync: TeamMemorySync | null = null;

export function getTeamMemorySync(config?: Partial<MemorySyncConfig>): TeamMemorySync {
  if (!memorySync) {
    memorySync = new TeamMemorySync(config);
    if (config?.enabled !== false) {
      memorySync.start();
    }
  }
  return memorySync;
}

export async function setTeamMemory(teamId: string, key: string, value: unknown): Promise<TeamMemoryEntry> {
  return getTeamMemorySync().set(teamId, key, value);
}

export function getTeamMemory(teamId: string, key: string): TeamMemoryEntry | undefined {
  return getTeamMemorySync().get(teamId, key);
}

export function getAllTeamMemory(teamId: string): TeamMemoryEntry[] {
  return getTeamMemorySync().getAll(teamId);
}

export default TeamMemorySync;