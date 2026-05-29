/**
 * Fleet Mode — parallel subagent execution.
 * Matches Copilot CLI's /fleet command for parallelizable workloads.
 *
 * Dispatches multiple subagents concurrently to work on different parts
 * of a task simultaneously. An orchestrator validates and integrates results.
 */
import { EventEmitter } from "events";
import * as crypto from "crypto";
import logger from "@/utils/logger.js";

export interface FleetTask {
  id: string;
  description: string;
  prompt: string;
  status: "pending" | "running" | "complete" | "error";
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface FleetSession {
  id: string;
  tasks: FleetTask[];
  status: "pending" | "running" | "complete" | "error";
  events: EventEmitter;
  maxConcurrency: number;
}

/**
 * Create a fleet session with a list of tasks to run in parallel.
 */
export function createFleetSession(
  taskDescriptions: Array<{ description: string; prompt: string }>,
  maxConcurrency: number = 4,
): FleetSession {
  const session: FleetSession = {
    id: crypto.randomUUID(),
    tasks: taskDescriptions.map((t) => ({
      id: crypto.randomUUID(),
      description: t.description,
      prompt: t.prompt,
      status: "pending",
    })),
    status: "pending",
    events: new EventEmitter(),
    maxConcurrency,
  };
  return session;
}

/**
 * Run fleet tasks with concurrency limit.
 * Each task runs as an async operation — the actual agent execution
 * is delegated to the caller via the `executeTask` callback.
 */
export async function runFleet(
  session: FleetSession,
  executeTask: (task: FleetTask) => Promise<string>,
): Promise<void> {
  session.status = "running";
  session.events.emit("start", { taskId: session.id, taskCount: session.tasks.length });

  const queue = [...session.tasks];
  const running: Promise<void>[] = [];

  async function runNext(): Promise<void> {
    const task = queue.shift();
    if (!task) return;

    task.status = "running";
    task.startedAt = new Date().toISOString();
    session.events.emit("taskStart", { taskId: task.id, description: task.description });

    try {
      const result = await executeTask(task);
      task.status = "complete";
      task.result = result;
      task.completedAt = new Date().toISOString();
      session.events.emit("taskComplete", { taskId: task.id, description: task.description, result });
    } catch (err) {
      task.status = "error";
      task.error = String(err);
      task.completedAt = new Date().toISOString();
      session.events.emit("taskError", { taskId: task.id, description: task.description, error: String(err) });
    }

    // Run next task in queue
    if (queue.length > 0) {
      await runNext();
    }
  }

  // Start initial batch up to concurrency limit
  for (let i = 0; i < Math.min(session.maxConcurrency, queue.length); i++) {
    running.push(runNext());
  }

  await Promise.all(running);

  const allComplete = session.tasks.every((t) => t.status === "complete" || t.status === "error");
  session.status = allComplete ? "complete" : "error";
  session.events.emit("complete", {
    totalTasks: session.tasks.length,
    completed: session.tasks.filter((t) => t.status === "complete").length,
    errors: session.tasks.filter((t) => t.status === "error").length,
  });
}

/**
 * Get a summary of the fleet session.
 */
export function getFleetSummary(session: FleetSession): {
  total: number;
  pending: number;
  running: number;
  complete: number;
  error: number;
} {
  return {
    total: session.tasks.length,
    pending: session.tasks.filter((t) => t.status === "pending").length,
    running: session.tasks.filter((t) => t.status === "running").length,
    complete: session.tasks.filter((t) => t.status === "complete").length,
    error: session.tasks.filter((t) => t.status === "error").length,
  };
}
