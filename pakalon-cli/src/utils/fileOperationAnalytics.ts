/**
 * File Operation Analytics
 *
 * Tracks and analyzes file operations (read, write, delete, rename)
 * across the CLI session. Provides metrics for performance monitoring
 * and usage analytics.
 *
 * Features:
 * - Operation counting and timing
 * - Per-file and per-directory statistics
 * - Hot file detection
 * - Operation pattern analysis
 */

import * as path from "path";
import logger from "@/utils/logger.js";

export type FileOperationType = "read" | "write" | "delete" | "rename" | "stat" | "access";

export interface FileOperation {
  type: FileOperationType;
  filePath: string;
  timestamp: number;
  durationMs: number;
  bytes?: number;
  success: boolean;
  error?: string;
}

export interface FileStats {
  path: string;
  readCount: number;
  writeCount: number;
  deleteCount: number;
  totalBytesRead: number;
  totalBytesWritten: number;
  avgReadDuration: number;
  avgWriteDuration: number;
  lastAccessed: number;
}

export interface DirectoryStats {
  path: string;
  fileCount: number;
  operationCount: number;
  totalBytes: number;
}

export interface AnalyticsSummary {
  totalOperations: number;
  operationsByType: Record<FileOperationType, number>;
  successRate: number;
  avgDurationMs: number;
  totalBytesRead: number;
  totalBytesWritten: number;
  hotFiles: string[];
  hotDirectories: string[];
  timeRange: { start: number; end: number };
}

const HOT_FILE_THRESHOLD = 5;
const HOT_DIR_THRESHOLD = 10;
const MAX_HISTORY = 10000;

let operations: FileOperation[] = [];
let fileStatsMap = new Map<string, FileStats>();
let dirStatsMap = new Map<string, DirectoryStats>();

function getOrCreateFileStats(filePath: string): FileStats {
  const normalized = path.normalize(filePath);
  if (!fileStatsMap.has(normalized)) {
    fileStatsMap.set(normalized, {
      path: normalized,
      readCount: 0,
      writeCount: 0,
      deleteCount: 0,
      totalBytesRead: 0,
      totalBytesWritten: 0,
      avgReadDuration: 0,
      avgWriteDuration: 0,
      lastAccessed: 0,
    });
  }
  return fileStatsMap.get(normalized)!;
}

function getOrCreateDirStats(dirPath: string): DirectoryStats {
  const normalized = path.normalize(dirPath);
  if (!dirStatsMap.has(normalized)) {
    dirStatsMap.set(normalized, {
      path: normalized,
      fileCount: 0,
      operationCount: 0,
      totalBytes: 0,
    });
  }
  return dirStatsMap.get(normalized)!;
}

function updateFileStats(op: FileOperation): void {
  const stats = getOrCreateFileStats(op.filePath);
  stats.lastAccessed = op.timestamp;

  switch (op.type) {
    case "read":
      stats.readCount++;
      stats.totalBytesRead += op.bytes ?? 0;
      stats.avgReadDuration = (stats.avgReadDuration * (stats.readCount - 1) + op.durationMs) / stats.readCount;
      break;
    case "write":
      stats.writeCount++;
      stats.totalBytesWritten += op.bytes ?? 0;
      stats.avgWriteDuration = (stats.avgWriteDuration * (stats.writeCount - 1) + op.durationMs) / stats.writeCount;
      break;
    case "delete":
      stats.deleteCount++;
      break;
  }

  const dirPath = path.dirname(op.filePath);
  const dirStats = getOrCreateDirStats(dirPath);
  dirStats.operationCount++;
  dirStats.totalBytes += op.bytes ?? 0;
}

export function recordOperation(op: Omit<FileOperation, "timestamp">): void {
  const operation: FileOperation = {
    ...op,
    timestamp: Date.now(),
  };

  operations.push(operation);
  if (operations.length > MAX_HISTORY) {
    operations = operations.slice(-MAX_HISTORY);
  }

  if (op.success) {
    updateFileStats(operation);
  }

  logger.debug("[fileAnalytics] Operation recorded", {
    type: op.type,
    path: op.filePath,
    durationMs: op.durationMs,
    success: op.success,
  });
}

export function recordOperationSync(
  type: FileOperationType,
  filePath: string,
  durationMs: number,
  bytes?: number,
  success = true,
  error?: string,
): void {
  recordOperation({
    type,
    filePath,
    durationMs,
    bytes,
    success,
    error,
  });
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const opsByType: Record<FileOperationType, number> = {
    read: 0,
    write: 0,
    delete: 0,
    rename: 0,
    stat: 0,
    access: 0,
  };

  let totalDuration = 0;
  let successCount = 0;
  let totalBytesRead = 0;
  let totalBytesWritten = 0;

  for (const op of operations) {
    opsByType[op.type]++;
    totalDuration += op.durationMs;
    if (op.success) successCount++;
    if (op.type === "read") totalBytesRead += op.bytes ?? 0;
    if (op.type === "write") totalBytesWritten += op.bytes ?? 0;
  }

  const hotFiles = Array.from(fileStatsMap.entries())
    .filter(([, stats]) => stats.readCount + stats.writeCount >= HOT_FILE_THRESHOLD)
    .sort(([, a], [, b]) => (b.readCount + b.writeCount) - (a.readCount + a.writeCount))
    .slice(0, 20)
    .map(([p]) => p);

  const hotDirectories = Array.from(dirStatsMap.entries())
    .filter(([, stats]) => stats.operationCount >= HOT_DIR_THRESHOLD)
    .sort(([, a], [, b]) => b.operationCount - a.operationCount)
    .slice(0, 10)
    .map(([p]) => p);

  const timestamps = operations.map((o) => o.timestamp);
  const timeRange = {
    start: timestamps.length > 0 ? Math.min(...timestamps) : 0,
    end: timestamps.length > 0 ? Math.max(...timestamps) : 0,
  };

  return {
    totalOperations: operations.length,
    operationsByType: opsByType,
    successRate: operations.length > 0 ? successCount / operations.length : 0,
    avgDurationMs: operations.length > 0 ? totalDuration / operations.length : 0,
    totalBytesRead,
    totalBytesWritten,
    hotFiles,
    hotDirectories,
    timeRange,
  };
}

export function getFileStats(filePath: string): FileStats | null {
  return fileStatsMap.get(path.normalize(filePath)) ?? null;
}

export function getAllFileStats(): ReadonlyMap<string, FileStats> {
  return fileStatsMap;
}

export function getDirectoryStats(dirPath: string): DirectoryStats | null {
  return dirStatsMap.get(path.normalize(dirPath)) ?? null;
}

export function getAllDirectoryStats(): ReadonlyMap<string, DirectoryStats> {
  return dirStatsMap;
}

export function getRecentOperations(count: number = 50): ReadonlyArray<FileOperation> {
  return operations.slice(-count);
}

export function clearAnalytics(): void {
  operations = [];
  fileStatsMap.clear();
  dirStatsMap.clear();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatAnalyticsReport(): string {
  const summary = getAnalyticsSummary();
  const lines = [
    "=== File Operation Analytics ===",
    `Total Operations: ${summary.totalOperations}`,
    `Success Rate: ${(summary.successRate * 100).toFixed(1)}%`,
    `Avg Duration: ${summary.avgDurationMs.toFixed(1)}ms`,
    "",
    "Operations by Type:",
    `  Read:   ${summary.operationsByType.read}`,
    `  Write:  ${summary.operationsByType.write}`,
    `  Delete: ${summary.operationsByType.delete}`,
    `  Rename: ${summary.operationsByType.rename}`,
    `  Stat:   ${summary.operationsByType.stat}`,
    `  Access: ${summary.operationsByType.access}`,
    "",
    `Total Read:    ${formatBytes(summary.totalBytesRead)}`,
    `Total Written: ${formatBytes(summary.totalBytesWritten)}`,
    "",
    "Hot Files:",
    ...summary.hotFiles.slice(0, 10).map((f) => `  ${f}`),
    "",
    "Hot Directories:",
    ...summary.hotDirectories.slice(0, 5).map((d) => `  ${d}`),
    "================================",
  ];
  return lines.join("\n");
}
