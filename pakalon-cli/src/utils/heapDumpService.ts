/**
 * Heap Dump Service
 *
 * Provides memory heap snapshot capture and analysis.
 * Useful for debugging memory leaks in long-running CLI sessions.
 *
 * Usage:
 *   import { captureHeapDump, getMemoryStats } from "@/utils/heapDumpService.js";
 *   const path = await captureHeapDump();
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import logger from "@/utils/logger.js";

export interface HeapDumpOptions {
  outputPath?: string;
  includeTimestamp?: boolean;
  compress?: boolean;
}

export interface MemoryStats {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  heapUsedPercent: number;
  timestamp: number;
}

export interface HeapDumpInfo {
  path: string;
  size: number;
  timestamp: number;
  memoryStats: MemoryStats;
}

let dumpHistory: HeapDumpInfo[] = [];
const MAX_HISTORY = 20;

function getMemoryStats(): MemoryStats {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers ?? 0,
    heapUsedPercent: (mem.heapUsed / mem.heapTotal) * 100,
    timestamp: Date.now(),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function captureHeapDump(options: HeapDumpOptions = {}): Promise<HeapDumpInfo | null> {
  const {
    outputPath,
    includeTimestamp = true,
    compress = false,
  } = options;

  try {
    const v8 = await import("v8");
    const stats = getMemoryStats();

    const timestamp = includeTimestamp ? `-${Date.now()}` : "";
    const hash = createHash("md5").update(`${Date.now()}-${stats.heapUsed}`).digest("hex").slice(0, 8);
    const ext = compress ? ".heapsnapshot.gz" : ".heapsnapshot";
    const dest = outputPath ?? path.join(os.tmpdir(), `pakalon-heap-${hash}${timestamp}${ext}`);

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const snapshot = v8.getHeapSnapshot();
    const writeStream = fs.createWriteStream(dest);

    await new Promise<void>((resolve, reject) => {
      snapshot.pipe(writeStream);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
    });

    const size = fs.statSync(dest).size;
    const info: HeapDumpInfo = {
      path: dest,
      size,
      timestamp: Date.now(),
      memoryStats: stats,
    };

    dumpHistory.push(info);
    if (dumpHistory.length > MAX_HISTORY) {
      dumpHistory.shift();
    }

    logger.info("[heapDump] Heap snapshot captured", {
      path: dest,
      size: formatBytes(size),
      heapUsed: formatBytes(stats.heapUsed),
      heapUsedPercent: stats.heapUsedPercent.toFixed(1) + "%",
    });

    return info;
  } catch (err) {
    logger.error("[heapDump] Failed to capture heap snapshot", { error: err });
    return null;
  }
}

export function getMemoryUsageReport(): string {
  const stats = getMemoryStats();
  const lines = [
    "=== Memory Usage Report ===",
    `RSS:          ${formatBytes(stats.rss)}`,
    `Heap Total:   ${formatBytes(stats.heapTotal)}`,
    `Heap Used:    ${formatBytes(stats.heapUsed)}`,
    `Heap Used:    ${stats.heapUsedPercent.toFixed(1)}%`,
    `External:     ${formatBytes(stats.external)}`,
    `ArrayBuffers: ${formatBytes(stats.arrayBuffers)}`,
    `Timestamp:    ${new Date(stats.timestamp).toISOString()}`,
    "=========================",
  ];
  return lines.join("\n");
}

export function logMemoryStats(): void {
  const stats = getMemoryStats();
  logger.info("[heapDump] Memory stats", {
    rss: formatBytes(stats.rss),
    heapTotal: formatBytes(stats.heapTotal),
    heapUsed: formatBytes(stats.heapUsed),
    heapUsedPercent: `${stats.heapUsedPercent.toFixed(1)}%`,
  });
}

export function getDumpHistory(): ReadonlyArray<HeapDumpInfo> {
  return [...dumpHistory];
}

export function clearDumpHistory(): void {
  dumpHistory = [];
}

export function getMemoryTrend(samples: number = 10): {
  heapUsedDelta: number;
  trend: "increasing" | "decreasing" | "stable";
} {
  if (dumpHistory.length < 2) {
    return { heapUsedDelta: 0, trend: "stable" };
  }

  const recent = dumpHistory.slice(-samples);
  const first = recent[0]?.memoryStats.heapUsed ?? 0;
  const last = recent[recent.length - 1]?.memoryStats.heapUsed ?? 0;
  const delta = last - first;

  const threshold = 1024 * 1024; // 1MB
  let trend: "increasing" | "decreasing" | "stable" = "stable";
  if (delta > threshold) trend = "increasing";
  else if (delta < -threshold) trend = "decreasing";

  return { heapUsedDelta: delta, trend };
}

export { getMemoryStats, formatBytes };
