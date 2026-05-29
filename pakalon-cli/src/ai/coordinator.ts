/**
 * Coordinator/Swarm Mode — Multi-agent orchestration with task distribution.
 *
 * Implements a coordinator+worker architecture:
 * - Coordinator agent receives a complex task and breaks it into subtasks
 * - Worker agents execute subtasks in parallel
 * - Results are collected, aggregated, and returned
 * - Support for agent handoff between workers
 *
 * Usage:
 *   const coordinator = new Coordinator(config);
 *   const result = await coordinator.run("Build a REST API");
 *   // Coordinator plans, delegates, collects, and aggregates
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRole = "coordinator" | "worker" | "observer";

export interface CoordinatorConfig {
  /** Maximum number of concurrent workers */
  maxConcurrency: number;
  /** Model for coordinator planning */
  coordinatorModel: string;
  /** Model for worker execution */
  workerModel: string;
  /** Worker timeout in ms */
  workerTimeoutMs: number;
  /** Whether to allow worker-to-worker handoff */
  allowHandoff: boolean;
  /** Whether to collect results as they complete (stream) */
  streamResults: boolean;
}

export interface Subtask {
  id: string;
  description: string;
  assignedTo?: string;
  status: "pending" | "assigned" | "running" | "completed" | "failed";
  dependencies: string[]; // Subtask IDs that must complete first
  result?: string;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface WorkerSpec {
  id: string;
  name: string;
  model: string;
  tools: string[];
  instructions: string;
}

export interface CoordinatorResult {
  success: boolean;
  summary: string;
  subtaskResults: SubtaskResult[];
  totalDuration: number;
  workerCount: number;
}

export interface SubtaskResult {
  subtaskId: string;
  description: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  workerId: string;
}

export interface HandoffRequest {
  fromWorker: string;
  toWorker: string;
  context: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Config
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CoordinatorConfig = {
  maxConcurrency: 3,
  coordinatorModel: "anthropic/claude-sonnet-4-20250514",
  workerModel: "anthropic/claude-3.5-sonnet",
  workerTimeoutMs: 300000, // 5 minutes
  allowHandoff: true,
  streamResults: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Task Planner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Break a complex task into subtasks.
 * In production, this would use an LLM call. Here we provide a simple
 * heuristic-based planner plus an LLM planner callback.
 */
export function planSubtasks(
  task: string,
  llmPlanner?: (task: string) => Promise<Subtask[]>,
): Subtask[] {
  if (llmPlanner) {
    // Delegate to LLM for intelligent planning
    return []; // Will be populated by the planner
  }

  // Simple heuristic: create a single catch-all subtask
  return [
    {
      id: crypto.randomUUID(),
      description: task,
      status: "pending",
      dependencies: [],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Pool
// ─────────────────────────────────────────────────────────────────────────────

export class WorkerPool {
  private workers: WorkerSpec[] = [];
  private config: CoordinatorConfig;

  constructor(config: CoordinatorConfig, workers?: WorkerSpec[]) {
    this.config = config;
    this.workers = workers ?? [];
  }

  addWorker(worker: WorkerSpec): void {
    this.workers.push(worker);
    logger.info("[Coordinator] Worker added", { id: worker.id, name: worker.name });
  }

  removeWorker(workerId: string): boolean {
    const idx = this.workers.findIndex((w) => w.id === workerId);
    if (idx === -1) return false;
    this.workers.splice(idx, 1);
    return true;
  }

  getWorker(workerId: string): WorkerSpec | undefined {
    return this.workers.find((w) => w.id === workerId);
  }

  listWorkers(): WorkerSpec[] {
    return [...this.workers];
  }

  getAvailableWorkers(busyWorkerIds: Set<string>): WorkerSpec[] {
    return this.workers.filter((w) => !busyWorkerIds.has(w.id));
  }

  getWorkerCount(): number {
    return this.workers.length;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator
// ─────────────────────────────────────────────────────────────────────────────

export type SubtaskExecutorFn = (
  subtask: Subtask,
  worker: WorkerSpec,
) => Promise<string>;

export class Coordinator {
  private config: CoordinatorConfig;
  private pool: WorkerPool;
  private handoffHistory: HandoffRequest[] = [];

  constructor(
    config?: Partial<CoordinatorConfig>,
    workers?: WorkerSpec[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pool = new WorkerPool(this.config, workers);
  }

  /**
   * Run a complex task through the coordinator.
   *
   * @param task - The high-level task description
   * @param executeFn - Function to execute a subtask on a worker
   * @param plannerFn - Optional LLM-based planner for subtask breakdown
   * @returns Aggregated coordinator result
   */
  async run(
    task: string,
    executeFn: SubtaskExecutorFn,
    plannerFn?: (task: string) => Promise<Subtask[]>,
  ): Promise<CoordinatorResult> {
    const startTime = Date.now();
    logger.info("[Coordinator] Starting task", { task: task.slice(0, 100) });

    // Phase 1: Plan
    const subtasks = plannerFn
      ? await plannerFn(task)
      : planSubtasks(task);

    if (subtasks.length === 0) {
      return {
        success: false,
        summary: "Failed to plan subtasks",
        subtaskResults: [],
        totalDuration: 0,
        workerCount: this.pool.getWorkerCount(),
      };
    }

    logger.info("[Coordinator] Planned subtasks", { count: subtasks.length });

    // Phase 2: Execute with dependency resolution
    const results: SubtaskResult[] = [];
    const completed = new Set<string>();
    const busy = new Set<string>();

    while (completed.size < subtasks.length) {
      // Find ready subtasks (all deps completed)
      const ready = subtasks.filter(
        (s) =>
          s.status === "pending" &&
          s.dependencies.every((d) => completed.has(d)),
      );

      if (ready.length === 0 && completed.size < subtasks.length) {
        // Circular dependency or all workers busy
        const blocked = subtasks.filter((s) => s.status === "pending");
        if (blocked.length > 0 && busy.size > 0) {
          // Wait for workers to free up
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        break;
      }

      // Assign to available workers
      const available = this.pool.getAvailableWorkers(busy);
      const toRun = ready.slice(0, Math.min(ready.length, available.length, this.config.maxConcurrency));

      const executionPromises = toRun.map(async (subtask) => {
        const worker = available.shift() ?? this.createDefaultWorker();
        subtask.status = "assigned";
        subtask.assignedTo = worker.id;
        subtask.status = "running";
        subtask.startedAt = new Date();
        busy.add(worker.id);

        try {
          const workerResult = await executeFn(subtask, worker);
          subtask.status = "completed";
          subtask.result = workerResult;
          subtask.completedAt = new Date();
          completed.add(subtask.id);

          results.push({
            subtaskId: subtask.id,
            description: subtask.description,
            success: true,
            output: workerResult,
            duration: subtask.completedAt.getTime() - subtask.startedAt.getTime(),
            workerId: worker.id,
          });
        } catch (err) {
          subtask.status = "failed";
          subtask.error = err instanceof Error ? err.message : String(err);
          subtask.completedAt = new Date();
          completed.add(subtask.id);

          results.push({
            subtaskId: subtask.id,
            description: subtask.description,
            success: false,
            error: subtask.error,
            duration: subtask.completedAt.getTime() - subtask.startedAt.getTime(),
            workerId: worker.id,
          });
        } finally {
          busy.delete(worker.id);
        }
      });

      await Promise.all(executionPromises);
    }

    const totalDuration = Date.now() - startTime;
    const successes = results.filter((r) => r.success).length;

    // Phase 3: Aggregate
    const summary = this.aggregateResults(results, task);

    logger.info("[Coordinator] Task completed", {
      subtasks: subtasks.length,
      successes,
      failures: results.length - successes,
      duration: totalDuration,
    });

    return {
      success: successes === subtasks.length,
      summary,
      subtaskResults: results,
      totalDuration,
      workerCount: this.pool.getWorkerCount(),
    };
  }

  /**
   * Request handoff from one worker to another.
   */
  async requestHandoff(
    fromWorkerId: string,
    toWorkerId: string,
    context: string,
    reason: string,
  ): Promise<boolean> {
    if (!this.config.allowHandoff) {
      logger.warn("[Coordinator] Handoff disabled");
      return false;
    }

    const from = this.pool.getWorker(fromWorkerId);
    const to = this.pool.getWorker(toWorkerId);

    if (!from || !to) {
      logger.warn("[Coordinator] Handoff failed: worker not found");
      return false;
    }

    const handoff: HandoffRequest = {
      fromWorker: fromWorkerId,
      toWorker: toWorkerId,
      context,
      reason,
    };

    this.handoffHistory.push(handoff);
    logger.info("[Coordinator] Handoff", { from: fromWorkerId, to: toWorkerId, reason });
    return true;
  }

  /**
   * Get the worker pool.
   */
  getPool(): WorkerPool {
    return this.pool;
  }

  /**
   * Get handoff history.
   */
  getHandoffHistory(): HandoffRequest[] {
    return [...this.handoffHistory];
  }

  /**
   * Get coordinator configuration.
   */
  getConfig(): CoordinatorConfig {
    return { ...this.config };
  }

  /**
   * Get coordination statistics.
   */
  getStats(): {
    workers: number;
    handoffs: number;
    maxConcurrency: number;
    allowHandoff: boolean;
  } {
    return {
      workers: this.pool.getWorkerCount(),
      handoffs: this.handoffHistory.length,
      maxConcurrency: this.config.maxConcurrency,
      allowHandoff: this.config.allowHandoff,
    };
  }

  /**
   * Aggregate subtask results into a summary.
   */
  private aggregateResults(results: SubtaskResult[], task: string): string {
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);
    const lines: string[] = [];

    lines.push(`Task: ${task}`);
    lines.push(`Subtasks: ${results.length} total, ${successes.length} succeeded, ${failures.length} failed`);
    lines.push("");

    for (const result of results) {
      const status = result.success ? "✅" : "❌";
      lines.push(`${status} ${result.description}`);
      if (result.output) {
        lines.push(`   Output: ${result.output.slice(0, 200)}${result.output.length > 200 ? "..." : ""}`);
      }
      if (result.error) {
        lines.push(`   Error: ${result.error}`);
      }
      lines.push(`   Worker: ${result.workerId} (${result.duration}ms)`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private createDefaultWorker(): WorkerSpec {
    const id = `worker-${crypto.randomUUID().slice(0, 8)}`;
    const worker: WorkerSpec = {
      id,
      name: id,
      model: this.config.workerModel,
      tools: ["*"],
      instructions: "Execute the assigned subtask using available tools.",
    };
    this.pool.addWorker(worker);
    return worker;
  }
}

/**
 * Create a default coordinator with standard workers.
 */
export function createDefaultCoordinator(): Coordinator {
  return new Coordinator(undefined, [
    {
      id: "worker-1",
      name: "Frontend Worker",
      model: "anthropic/claude-sonnet-4-20250514",
      tools: ["*"],
      instructions: "Specialize in frontend code (React, CSS, HTML, TypeScript).",
    },
    {
      id: "worker-2",
      name: "Backend Worker",
      model: "anthropic/claude-sonnet-4-20250514",
      tools: ["*"],
      instructions: "Specialize in backend code (APIs, databases, server logic).",
    },
    {
      id: "worker-3",
      name: "DevOps Worker",
      model: "anthropic/claude-3.5-sonnet",
      tools: ["bash", "readFile", "writeFile", "glob", "grep"],
      instructions: "Specialize in infrastructure, CI/CD, and deployment.",
    },
  ]);
}
