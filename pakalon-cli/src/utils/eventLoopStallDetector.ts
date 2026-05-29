/**
 * Event Loop Stall Detector
 *
 * Monitors the Node.js event loop for stalls (blocking operations).
 * Reports when the event loop is blocked for longer than a threshold.
 * Useful for detecting performance issues in async-heavy code.
 *
 * Usage:
 *   import { startStallDetection, stopStallDetection } from "@/utils/eventLoopStallDetector.js";
 *   startStallDetection({ thresholdMs: 100 });
 */

import logger from "@/utils/logger.js";

export interface StallDetectorOptions {
  thresholdMs?: number;
  sampleIntervalMs?: number;
  onStall?: (stallDuration: number) => void;
  maxStalls?: number;
  autoStopAfter?: number;
}

export interface StallEvent {
  timestamp: number;
  duration: number;
  stack?: string;
}

const DEFAULT_OPTIONS: Required<StallDetectorOptions> = {
  thresholdMs: 100,
  sampleIntervalMs: 50,
  onStall: (duration: number) => {
    logger.warn("[eventLoopStall] Event loop stall detected", { durationMs: duration });
  },
  maxStalls: 100,
  autoStopAfter: 0,
};

let detectorActive = false;
let stallCount = 0;
let lastCheckTime = 0;
let stallHistory: StallEvent[] = [];
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let options: Required<StallDetectorOptions> = DEFAULT_OPTIONS;

function checkLoop(): void {
  if (!detectorActive) return;

  const now = Date.now();
  const elapsed = now - lastCheckTime;

  if (elapsed > options.thresholdMs) {
    stallCount++;
    const stall: StallEvent = {
      timestamp: now,
      duration: elapsed,
      stack: new Error().stack?.split("\n").slice(3).join("\n"),
    };
    stallHistory.push(stall);

    if (stallHistory.length > options.maxStalls) {
      stallHistory.shift();
    }

    options.onStall(elapsed);

    if (options.autoStopAfter > 0 && stallCount >= options.autoStopAfter) {
      logger.warn("[eventLoopStall] Auto-stopping detector after max stalls", { stallCount });
      stopStallDetection();
      return;
    }
  }

  lastCheckTime = Date.now();
  activeTimer = setTimeout(checkLoop, options.sampleIntervalMs);
}

export function startStallDetection(userOptions: StallDetectorOptions = {}): void {
  if (detectorActive) return;

  options = { ...DEFAULT_OPTIONS, ...userOptions };
  detectorActive = true;
  stallCount = 0;
  stallHistory = [];
  lastCheckTime = Date.now();

  logger.debug("[eventLoopStall] Starting stall detection", {
    thresholdMs: options.thresholdMs,
    sampleIntervalMs: options.sampleIntervalMs,
  });

  activeTimer = setTimeout(checkLoop, options.sampleIntervalMs);
}

export function stopStallDetection(): void {
  detectorActive = false;
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  logger.debug("[eventLoopStall] Stopped stall detection", { totalStalls: stallCount });
}

export function isStallDetectionActive(): boolean {
  return detectorActive;
}

export function getStallHistory(): ReadonlyArray<StallEvent> {
  return [...stallHistory];
}

export function getStallCount(): number {
  return stallCount;
}

export function resetStallHistory(): void {
  stallHistory = [];
  stallCount = 0;
}

export function getAverageStallDuration(): number {
  if (stallHistory.length === 0) return 0;
  const total = stallHistory.reduce((sum, s) => sum + s.duration, 0);
  return total / stallHistory.length;
}

export function getMaxStallDuration(): number {
  if (stallHistory.length === 0) return 0;
  return Math.max(...stallHistory.map((s) => s.duration));
}

export function getStallSummary(): {
  count: number;
  avgDuration: number;
  maxDuration: number;
  recentStalls: StallEvent[];
} {
  return {
    count: stallCount,
    avgDuration: getAverageStallDuration(),
    maxDuration: getMaxStallDuration(),
    recentStalls: stallHistory.slice(-10),
  };
}
