/**
 * Tool Execution Mode — Parallel vs Sequential tool execution control.
 *
 * Controls how tools are executed within a single agent turn:
 * - sequential: Tools run one at a time (default, safer)
 * - parallel: Independent tools run concurrently (faster for independent ops)
 * - parallel_all: All tools run concurrently (fastest, riskiest)
 *
 * Also provides dependency detection to determine which tools can
 * safely run in parallel vs must run sequentially.
 *
 * Usage:
 *   const mode = new ToolExecutionModeManager();
 *   mode.setMode("parallel");
 *
 *   const executor = mode.createExecutor(toolCalls);
 *   const results = await executor.execute();
 */

import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionMode = "sequential" | "parallel" | "parallel_all";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Optional file path if the tool operates on a file */
  filePath?: string;
}

export interface ToolDependency {
  from: string; // tool call ID
  to: string;   // dependent tool call ID
  reason: string;
}

export interface ExecutionPlan {
  mode: ExecutionMode;
  batches: ToolCallInfo[][]; // Tools in the same batch can run in parallel
  dependencies: ToolDependency[];
  totalTools: number;
  estimatedBatches: number;
}

export interface ToolExecutionResult {
  id: string;
  name: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect dependencies between tool calls.
 * Used to determine safe parallelism.
 */
export function detectDependencies(toolCalls: ToolCallInfo[]): ToolDependency[] {
  const deps: ToolDependency[] = [];
  const fileReads = new Set<string>();
  const fileWrites = new Map<string, string>(); // file -> tool ID that wrote it

  for (let i = 0; i < toolCalls.length; i++) {
    const current = toolCalls[i]!;
    const filePath = current.filePath ?? extractFilePath(current);

    if (filePath) {
      // Read after write → dependency
      if (fileWrites.has(filePath) && isReadTool(current.name)) {
        const writerId = fileWrites.get(filePath)!;
        deps.push({
          from: writerId,
          to: current.id,
          reason: `Read after write: ${filePath}`,
        });
      }

      // Write after read → dependency
      if (isWriteTool(current.name) && fileReads.has(filePath)) {
        // Find which tool read it
        for (let j = 0; j < i; j++) {
          const prev = toolCalls[j]!;
          const prevPath = prev.filePath ?? extractFilePath(prev);
          if (prevPath === filePath && isReadTool(prev.name)) {
            deps.push({
              from: prev.id,
              to: current.id,
              reason: `Write after read: ${filePath}`,
            });
          }
        }
      }

      // Track file operations
      if (isReadTool(current.name)) {
        fileReads.add(filePath);
      }
      if (isWriteTool(current.name)) {
        fileWrites.set(filePath, current.id);
      }
    }

    // Sequential dependency on grep→read patterns (logical dependency)
    if (
      current.name.toLowerCase() === "grep" ||
      current.name.toLowerCase() === "glob"
    ) {
      // Next tool might depend on grep output
      if (i + 1 < toolCalls.length) {
        const next = toolCalls[i + 1]!;
        // Only add if same file or next is a write
        if (next.name.toLowerCase() === "writefile" || next.name.toLowerCase() === "editfile") {
          deps.push({
            from: current.id,
            to: next.id,
            reason: "Logical dependency: search before edit",
          });
        }
      }
    }
  }

  return deps;
}

/**
 * Extract file path from tool arguments.
 */
function extractFilePath(tool: ToolCallInfo): string | undefined {
  const args = tool.args;
  if (typeof args.filePath === "string") return args.filePath;
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.path === "string") return args.path;
  if (typeof args.file === "string") return args.file;
  return undefined;
}

const READ_TOOLS = new Set(["readfile", "read_file", "view", "grep", "glob", "webfetch", "listdir"]);
const WRITE_TOOLS = new Set(["writefile", "write_file", "editfile", "edit_file", "patchfile", "deletefile", "renamefile"]);

function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name.toLowerCase());
}

function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name.toLowerCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Planner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plan tool execution batches based on mode and dependencies.
 */
export function planExecution(
  toolCalls: ToolCallInfo[],
  mode: ExecutionMode,
): ExecutionPlan {
  if (toolCalls.length === 0) {
    return { mode, batches: [], dependencies: [], totalTools: 0, estimatedBatches: 0 };
  }

  const dependencies = detectDependencies(toolCalls);

  if (mode === "sequential") {
    return {
      mode,
      batches: toolCalls.map((t) => [t]),
      dependencies,
      totalTools: toolCalls.length,
      estimatedBatches: toolCalls.length,
    };
  }

  if (mode === "parallel_all") {
    return {
      mode,
      batches: [toolCalls],
      dependencies,
      totalTools: toolCalls.length,
      estimatedBatches: 1,
    };
  }

  // "parallel" mode — batch independent tools together
  return {
    mode,
    batches: batchIndependentTools(toolCalls, dependencies),
    dependencies,
    totalTools: toolCalls.length,
    estimatedBatches: 0,
  };
}

/**
 * Batch tools into groups that can safely run in parallel.
 * Tools with dependencies on each other go in separate batches.
 */
function batchIndependentTools(
  toolCalls: ToolCallInfo[],
  dependencies: ToolDependency[],
): ToolCallInfo[][] {
  const depMap = new Map<string, Set<string>>();

  for (const dep of dependencies) {
    if (!depMap.has(dep.to)) depMap.set(dep.to, new Set());
    depMap.get(dep.to)!.add(dep.from);
  }

  const batches: ToolCallInfo[][] = [];
  const assigned = new Set<string>();
  let remaining = new Set(toolCalls.map((t) => t.id));

  while (remaining.size > 0) {
    const batch: ToolCallInfo[] = [];

    for (const tool of toolCalls) {
      if (assigned.has(tool.id)) continue;

      const deps = depMap.get(tool.id);
      // Tool can run in this batch if all its deps are assigned
      if (!deps || [...deps].every((d) => assigned.has(d))) {
        batch.push(tool);
      }
    }

    if (batch.length === 0) {
      // Circular dependency — fall through to sequential
      for (const tool of toolCalls) {
        if (!assigned.has(tool.id)) {
          batch.push(tool);
          break;
        }
      }
    }

    for (const tool of batch) {
      assigned.add(tool.id);
      remaining.delete(tool.id);
    }

    batches.push(batch);

    // Safety: prevent infinite loop
    if (batches.length > toolCalls.length * 2) break;
  }

  return batches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Mode Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages tool execution mode and creates executors.
 */
export class ToolExecutionModeManager {
  private mode: ExecutionMode = "sequential";
  private onChangeCallbacks: Array<(mode: ExecutionMode) => void> = [];

  /**
   * Set the execution mode.
   */
  setMode(mode: ExecutionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    logger.info("[ToolExecMode] Mode set", { mode });
    for (const cb of this.onChangeCallbacks) {
      try {
        cb(mode);
      } catch {
        // Swallow
      }
    }
  }

  /**
   * Get the current execution mode.
   */
  getMode(): ExecutionMode {
    return this.mode;
  }

  /**
   * Toggle between sequential and parallel.
   */
  toggle(): ExecutionMode {
    const next: ExecutionMode = this.mode === "sequential" ? "parallel" : "sequential";
    this.setMode(next);
    return next;
  }

  /**
   * Register a mode change callback.
   */
  onChange(cb: (mode: ExecutionMode) => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => {
      this.onChangeCallbacks = this.onChangeCallbacks.filter((c) => c !== cb);
    };
  }

  /**
   * Create an execution plan for the given tool calls.
   */
  plan(toolCalls: ToolCallInfo[]): ExecutionPlan {
    return planExecution(toolCalls, this.mode);
  }

  /**
   * Execute tool calls according to the mode.
   *
   * @param toolCalls - The tool calls to execute
   * @param executeFn - Function to execute a single tool call
   * @returns Results in the same order as toolCalls
   */
  async execute(
    toolCalls: ToolCallInfo[],
    executeFn: (tool: ToolCallInfo) => Promise<ToolExecutionResult>,
    onBatchComplete?: (batch: ToolCallInfo[], results: ToolExecutionResult[]) => void,
  ): Promise<ToolExecutionResult[]> {
    const plan = this.plan(toolCalls);
    const results: ToolExecutionResult[] = [];
    const resultMap = new Map<string, ToolExecutionResult>();

    logger.info("[ToolExecMode] Starting execution", {
      mode: plan.mode,
      batches: plan.batches.length,
      tools: plan.totalTools,
    });

    for (let batchIdx = 0; batchIdx < plan.batches.length; batchIdx++) {
      const batch = plan.batches[batchIdx]!;

      if (batch.length === 1) {
        // Sequential execution
        const result = await executeFn(batch[0]!);
        resultMap.set(result.id, result);
        results.push(result);
      } else {
        // Parallel execution
        const batchResults = await Promise.all(
          batch.map((tool) => executeFn(tool)),
        );
        for (const result of batchResults) {
          resultMap.set(result.id, result);
          results.push(result);
        }
        onBatchComplete?.(batch, batchResults);
      }

      logger.debug("[ToolExecMode] Batch completed", {
        batch: batchIdx + 1,
        of: plan.batches.length,
        tools: batch.length,
      });
    }

    // Return in original order
    return toolCalls.map((t) => resultMap.get(t.id) ?? {
      id: t.id,
      name: t.name,
      success: false,
      error: "Tool not executed",
      duration: 0,
    });
  }
}
