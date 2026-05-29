/**
 * Sleep Tool - Wait for a specified duration
 *
 * Allows the agent to pause execution for a specified duration.
 * The user can interrupt the sleep at any time.
 *
 * Features:
 * - Configurable duration (milliseconds)
 * - Interruptible via user input
 * - Periodic tick support for background work
 * - Non-blocking (doesn't hold a shell process)
 */

import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SleepOptions {
  /** Duration to sleep in milliseconds */
  durationMs: number;
  /** Whether the sleep can be interrupted */
  interruptible?: boolean;
  /** Callback for tick events (periodic check-ins) */
  onTick?: () => void;
}

export interface SleepResult {
  /** Whether the sleep completed or was interrupted */
  completed: boolean;
  /** Actual duration slept in milliseconds */
  actualDurationMs: number;
  /** Number of ticks that occurred */
  tickCount: number;
  /** Reason for completion (completed/interrupted) */
  reason: "completed" | "interrupted";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_MS = 1000; // 1 second
const MAX_DURATION_MS = 300_000; // 5 minutes
const TICK_INTERVAL_MS = 5000; // 5 seconds between ticks

// ---------------------------------------------------------------------------
// Sleep Controller
// ---------------------------------------------------------------------------

class SleepController {
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Create a new abort controller for a sleep operation
   */
  createController(id: string): AbortController {
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    return controller;
  }

  /**
   * Abort a specific sleep operation
   */
  abort(id: string): boolean {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Abort all sleep operations
   */
  abortAll(): void {
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /**
   * Check if a sleep operation is active
   */
  isActive(id: string): boolean {
    return this.abortControllers.has(id);
  }
}

// Singleton controller
export const sleepController = new SleepController();

// ---------------------------------------------------------------------------
// Core Sleep Function
// ---------------------------------------------------------------------------

/**
 * Sleep for a specified duration with tick support and interruption
 */
export async function sleep(options: SleepOptions): Promise<SleepResult> {
  const { durationMs, interruptible = true, onTick } = options;
  const id = crypto.randomUUID();
  const controller = sleepController.createController(id);

  const clampedDuration = Math.min(Math.max(1, durationMs), MAX_DURATION_MS);
  const startTime = Date.now();
  let tickCount = 0;

  logger.info(`[Sleep] Starting sleep for ${clampedDuration}ms (id: ${id})`);

  try {
    await new Promise<void>((resolve, reject) => {
      // Set up tick interval
      let tickInterval: ReturnType<typeof setInterval> | null = null;
      if (onTick && clampedDuration > TICK_INTERVAL_MS) {
        tickInterval = setInterval(() => {
          tickCount++;
          try {
            onTick();
          } catch (err) {
            logger.warn(`[Sleep] Tick callback error: ${err}`);
          }
        }, TICK_INTERVAL_MS);
      }

      // Set up main sleep timeout
      const timeout = setTimeout(() => {
        if (tickInterval) clearInterval(tickInterval);
        resolve();
      }, clampedDuration);

      // Handle interruption
      if (interruptible) {
        controller.signal.addEventListener("abort", () => {
          if (tickInterval) clearInterval(tickInterval);
          clearTimeout(timeout);
          reject(new Error("Sleep interrupted"));
        });
      }
    });

    const actualDuration = Date.now() - startTime;
    logger.info(`[Sleep] Sleep completed after ${actualDuration}ms (${tickCount} ticks)`);

    return {
      completed: true,
      actualDurationMs: actualDuration,
      tickCount,
      reason: "completed",
    };
  } catch (error) {
    const actualDuration = Date.now() - startTime;
    const isInterrupted = error instanceof Error && error.message === "Sleep interrupted";

    if (isInterrupted) {
      logger.info(`[Sleep] Sleep interrupted after ${actualDuration}ms`);
      return {
        completed: false,
        actualDurationMs: actualDuration,
        tickCount,
        reason: "interrupted",
      };
    }

    throw error;
  } finally {
    sleepController.abort(id);
  }
}

// ---------------------------------------------------------------------------
// Tool Schema
// ---------------------------------------------------------------------------

export const sleepToolInputSchema = z.object({
  durationMs: z
    .number()
    .int()
    .min(1)
    .max(MAX_DURATION_MS)
    .describe("Duration to sleep in milliseconds"),
  interruptible: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether the sleep can be interrupted by the user"),
});

export type SleepToolInput = z.infer<typeof sleepToolInputSchema>;

// ---------------------------------------------------------------------------
// Tool Executor
// ---------------------------------------------------------------------------

/**
 * Execute the sleep tool
 */
export async function executeSleepTool(input: SleepToolInput): Promise<SleepResult> {
  const { durationMs, interruptible = true } = input;

  return sleep({
    durationMs,
    interruptible,
    onTick: () => {
      logger.debug(`[Sleep] Tick at ${Date.now()}`);
    },
  });
}

/**
 * Interrupt an active sleep operation
 */
export function interruptSleep(id: string): boolean {
  return sleepController.abort(id);
}

/**
 * Interrupt all active sleep operations
 */
export function interruptAllSleeps(): void {
  sleepController.abortAll();
}
