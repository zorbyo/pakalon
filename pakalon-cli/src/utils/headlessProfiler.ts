/**
 * Headless Profiler
 *
 * Lightweight performance profiler for measuring execution time,
 * memory usage, and resource consumption of CLI operations.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export interface ProfileSpan {
  id: string;
  name: string;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  children: string[];
  parentId: string | null;
}

export interface ProfileReport {
  spans: ProfileSpan[];
  totalDurationMs: number;
  peakMemoryMB: number;
  gcCount: number;
  timestamp: number;
}

export interface ProfilerOptions {
  maxSpans?: number;
  enableMemoryTracking?: boolean;
  enableGCTracking?: boolean;
  reportPath?: string;
}

const DEFAULT_OPTIONS: Required<ProfilerOptions> = {
  maxSpans: 10000,
  enableMemoryTracking: true,
  enableGCTracking: false,
  reportPath: path.join(os.homedir(), ".config", "pakalon", "profiles"),
};

let spans = new Map<string, ProfileSpan>();
let activeSpans: string[] = [];
let nextId = 1;
let peakMemoryMB = 0;
let gcCount = 0;
let options: Required<ProfilerOptions>;
let isProfiling = false;

function generateSpanId(): string {
  return `span_${Date.now()}_${nextId++}`;
}

function getCurrentMemoryMB(): number {
  const usage = process.memoryUsage();
  return (usage.heapUsed + usage.external) / 1024 / 1024;
}

function updatePeakMemory(): void {
  if (!options.enableMemoryTracking) return;
  const current = getCurrentMemoryMB();
  if (current > peakMemoryMB) {
    peakMemoryMB = current;
  }
}

function setupGCTracking(): void {
  if (!options.enableGCTracking) return;
  if (globalThis.gc) {
    const originalGc = globalThis.gc;
    globalThis.gc = () => {
      gcCount++;
      return originalGc();
    };
  }
}

export function startProfiler(profilerOptions?: ProfilerOptions): void {
  options = { ...DEFAULT_OPTIONS, ...profilerOptions };
  spans.clear();
  activeSpans = [];
  peakMemoryMB = 0;
  gcCount = 0;
  nextId = 1;
  isProfiling = true;

  setupGCTracking();

  if (options.enableMemoryTracking) {
    updatePeakMemory();
  }

  logger.info("[profiler] started", options);
}

export function stopProfiler(): void {
  isProfiling = false;
  logger.info("[profiler] stopped", {
    totalSpans: spans.size,
    peakMemoryMB: Math.round(peakMemoryMB * 100) / 100,
  });
}

export function beginSpan(
  name: string,
  tags?: Record<string, string>,
  metadata?: Record<string, unknown>,
  parentId?: string,
): string {
  if (!isProfiling) return "";

  const id = generateSpanId();
  const span: ProfileSpan = {
    id,
    name,
    startTime: performance.now(),
    endTime: null,
    durationMs: null,
    tags: tags ?? {},
    metadata: metadata ?? {},
    children: [],
    parentId: parentId ?? (activeSpans.length > 0 ? activeSpans[activeSpans.length - 1]! : null),
  };

  if (span.parentId) {
    const parent = spans.get(span.parentId);
    if (parent) {
      parent.children.push(id);
    }
  }

  spans.set(id, span);
  activeSpans.push(id);

  if (spans.size > options.maxSpans) {
    evictOldestSpans();
  }

  return id;
}

export function endSpan(spanId: string): ProfileSpan | null {
  if (!isProfiling || !spanId) return null;

  const span = spans.get(spanId);
  if (!span || span.endTime !== null) return null;

  span.endTime = performance.now();
  span.durationMs = span.endTime - span.startTime;

  const idx = activeSpans.lastIndexOf(spanId);
  if (idx !== -1) {
    activeSpans.splice(idx, 1);
  }

  updatePeakMemory();

  if (span.durationMs > 1000) {
    logger.warn("[profiler] slow span detected", {
      name: span.name,
      durationMs: Math.round(span.durationMs),
    });
  }

  return span;
}

export function measureSpan<T>(
  name: string,
  fn: () => T,
  tags?: Record<string, string>,
): T {
  const spanId = beginSpan(name, tags);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        (value) => {
          endSpan(spanId);
          return value;
        },
        (error) => {
          endSpan(spanId);
          throw error;
        },
      ) as T;
    }
    endSpan(spanId);
    return result;
  } catch (error) {
    endSpan(spanId);
    throw error;
  }
}

export async function measureSpanAsync<T>(
  name: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>,
): Promise<T> {
  const spanId = beginSpan(name, tags);
  try {
    const result = await fn();
    endSpan(spanId);
    return result;
  } catch (error) {
    endSpan(spanId);
    throw error;
  }
}

function evictOldestSpans(): void {
  const toRemove = Math.floor(options.maxSpans * 0.1);
  const sorted = Array.from(spans.entries())
    .sort((a, b) => a[1].startTime - b[1].startTime)
    .slice(0, toRemove);

  for (const [id] of sorted) {
    spans.delete(id);
  }
}

export function getSpan(spanId: string): ProfileSpan | undefined {
  return spans.get(spanId);
}

export function getActiveSpans(): ProfileSpan[] {
  return activeSpans
    .map((id) => spans.get(id))
    .filter((s): s is ProfileSpan => s !== undefined);
}

export function generateReport(): ProfileReport {
  const completedSpans = Array.from(spans.values()).filter(
    (s) => s.endTime !== null,
  );

  let totalDurationMs = 0;
  if (completedSpans.length > 0) {
    const minStart = Math.min(...completedSpans.map((s) => s.startTime));
    const maxEnd = Math.max(...completedSpans.map((s) => s.endTime!));
    totalDurationMs = maxEnd - minStart;
  }

  updatePeakMemory();

  return {
    spans: Array.from(spans.values()),
    totalDurationMs: Math.round(totalDurationMs),
    peakMemoryMB: Math.round(peakMemoryMB * 100) / 100,
    gcCount,
    timestamp: Date.now(),
  };
}

export function saveReport(filename?: string): string {
  if (!isProfiling) return "";

  const report = generateReport();
  const dir = options.reportPath;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, filename ?? `profile-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  logger.info("[profiler] report saved", { path: filePath });
  return filePath;
}

export function getSlowSpans(thresholdMs = 100): ProfileSpan[] {
  return Array.from(spans.values())
    .filter((s) => s.durationMs !== null && s.durationMs! > thresholdMs)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
}

export function resetProfiler(): void {
  spans.clear();
  activeSpans = [];
  peakMemoryMB = 0;
  gcCount = 0;
  nextId = 1;
}
