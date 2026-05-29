/**
 * Auto-Dream: Automatic Memory Consolidation
 * 
 * Periodically consolidates and refines stored memories to keep them
 * relevant and up-to-date. Implements Claude's auto-dream feature.
 */

import { listMemories, storeMemory, deleteMemory } from "./store.js";
import type { MemoryEntry } from "./store.js";
import logger from "@/utils/logger.js";

export interface AutoDreamConfig {
  /** Minimum age (hours) before a memory is eligible for consolidation */
  minAgeHours: number;
  /** Maximum number of memories to process per run */
  maxMemoriesPerRun: number;
  /** Minimum memories required before auto-dream triggers */
  minMemoriesForAutoDream: number;
  /** How often to check for consolidation (in ms) */
  checkIntervalMs: number;
}

export const DEFAULT_AUTO_DREAM_CONFIG: AutoDreamConfig = {
  minAgeHours: 24,
  maxMemoriesPerRun: 10,
  minMemoriesForAutoDream: 5,
  checkIntervalMs: 60 * 60 * 1000, // 1 hour
};

let autoDreamConfig: AutoDreamConfig = { ...DEFAULT_AUTO_DREAM_CONFIG };
let autoDreamTimer: ReturnType<typeof setInterval> | null = null;
let consolidationLock = false;
let lastConsolidationTime: Date | null = null;

/**
 * Configure auto-dream settings
 */
export function configureAutoDream(config: Partial<AutoDreamConfig>): void {
  autoDreamConfig = { ...autoDreamConfig, ...config };
  logger.debug("[autoDream] Configuration updated", autoDreamConfig);
}

/**
 * Get current auto-dream configuration
 */
export function getAutoDreamConfig(): AutoDreamConfig {
  return { ...autoDreamConfig };
}

/**
 * Check if consolidation is currently in progress
 */
export function isConsolidationActive(): boolean {
  return consolidationLock;
}

/**
 * Check if memory should be consolidated (based on age)
 */
function shouldConsolidateMemory(memory: MemoryEntry, minAgeHours: number): boolean {
  const ageMs = Date.now() - new Date(memory.createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours >= minAgeHours;
}

/**
 * Merge similar memories together
 */
function mergeSimilarMemories(memories: MemoryEntry[]): MemoryEntry[][] {
  const groups: MemoryEntry[][] = [];
  const processed = new Set<string>();

  for (const memory of memories) {
    if (processed.has(memory.id)) continue;

    const group: MemoryEntry[] = [memory];
    processed.add(memory.id);

    const text1 = memory.text.toLowerCase();

    for (const other of memories) {
      if (processed.has(other.id)) continue;

      const text2 = other.text.toLowerCase();
      
      // Check for similarity (simple word overlap)
      const words1 = new Set(text1.split(/\s+/));
      const words2 = new Set(text2.split(/\s+/));
      const intersection = [...words1].filter(w => words2.has(w) && w.length > 3);
      
      if (intersection.length >= 3) {
        group.push(other);
        processed.add(other.id);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Consolidate old memories - merge similar ones and remove outdated ones
 */
export async function consolidateMemories(userId: string): Promise<{
  processed: number;
  merged: number;
  deleted: number;
  errors: string[];
}> {
  if (consolidationLock) {
    logger.debug("[autoDream] Consolidation already in progress, skipping");
    return { processed: 0, merged: 0, deleted: 0, errors: ["Consolidation already in progress"] };
  }

  consolidationLock = true;
  const errors: string[] = [];
  let processed = 0;
  let merged = 0;
  let deleted = 0;

  try {
    const allMemories = listMemories(userId);
    
    if (allMemories.length < autoDreamConfig.minMemoriesForAutoDream) {
      logger.debug("[autoDream] Not enough memories for consolidation", { 
        count: allMemories.length,
        required: autoDreamConfig.minMemoriesForAutoDream 
      });
      return { processed: 0, merged: 0, deleted: 0, errors: [] };
    }

    // Get eligible memories (old enough)
    const eligible = allMemories.filter(m => 
      shouldConsolidateMemory(m, autoDreamConfig.minAgeHours)
    ).slice(0, autoDreamConfig.maxMemoriesPerRun);

    if (eligible.length === 0) {
      logger.debug("[autoDream] No eligible memories for consolidation");
      return { processed: 0, merged: 0, deleted: 0, errors: [] };
    }

    // Group similar memories
    const groups = mergeSimilarMemories(eligible);

    for (const group of groups) {
      processed += group.length;

      if (group.length === 1) {
        // Single memory - check if still relevant
        // For now, we keep all memories unless they're duplicates
        continue;
      }

      // Multiple similar memories - merge them
      // Keep the most recent one and update it with combined info
      const sorted = group.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      const primary = sorted[0];
      const secondary = sorted.slice(1);

      // Merge metadata
      const combinedMetadata = { ...primary.metadata };
      for (const m of secondary) {
        merged++;
        if (m.metadata) {
          Object.assign(combinedMetadata, m.metadata);
        }
        // Delete the merged memory
        deleteMemory(userId, m.id);
        deleted++;
      }

      // Update primary with merged metadata
      storeMemory(
        primary.text,
        userId,
        primary.sessionId,
        {
          ...combinedMetadata,
          consolidatedAt: new Date().toISOString(),
          mergedFrom: secondary.map(m => m.id),
        }
      );
    }

    lastConsolidationTime = new Date();
    logger.info("[autoDream] Consolidation complete", { processed, merged, deleted });

  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    errors.push(error);
    logger.error("[autoDream] Consolidation error", { error });
  } finally {
    consolidationLock = false;
  }

  return { processed, merged, deleted, errors };
}

/**
 * Start automatic memory consolidation
 */
export function startAutoDream(userId: string): void {
  if (autoDreamTimer) {
    logger.debug("[autoDream] Already running");
    return;
  }

  logger.info("[autoDream] Starting auto-dream", { 
    userId,
    intervalMs: autoDreamConfig.checkIntervalMs 
  });

  autoDreamTimer = setInterval(async () => {
    if (!consolidationLock) {
      await consolidateMemories(userId);
    }
  }, autoDreamConfig.checkIntervalMs);
}

/**
 * Stop automatic memory consolidation
 */
export function stopAutoDream(): void {
  if (autoDreamTimer) {
    clearInterval(autoDreamTimer);
    autoDreamTimer = null;
    logger.info("[autoDream] Stopped");
  }
}

/**
 * Get last consolidation time
 */
export function getLastConsolidationTime(): Date | null {
  return lastConsolidationTime;
}

/**
 * Reset auto-dream state (useful for testing)
 */
export function resetAutoDream(): void {
  stopAutoDream();
  consolidationLock = false;
  lastConsolidationTime = null;
  autoDreamConfig = { ...DEFAULT_AUTO_DREAM_CONFIG };
}
