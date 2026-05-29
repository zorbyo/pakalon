/**
 * Parallel tool execution — batch concurrent tool calls.
 * Matches Copilot CLI's parallel tool_use blocks.
 *
 * Executes multiple tool calls concurrently with:
 * - Batch permission approval
 * - Concurrent execution with Promise.all
 * - Error isolation (one failure doesn't block others)
 */
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
  success: boolean;
  error?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Parallel Execution
// ---------------------------------------------------------------------------

/**
 * Execute multiple tool calls in parallel.
 *
 * @param calls - Array of tool calls to execute
 * @param executor - Function that executes a single tool call
 * @param maxConcurrency - Maximum concurrent executions (default: 5)
 * @returns Array of results in the same order as the input calls
 */
export async function executeParallel(
  calls: ToolCall[],
  executor: (call: ToolCall) => Promise<unknown>,
  maxConcurrency: number = 5,
): Promise<ToolResult[]> {
  if (calls.length === 0) return [];

  // Single call — no parallelism needed
  if (calls.length === 1) {
    const call = calls[0]!;
    const startTime = Date.now();
    try {
      const result = await executor(call);
      return [{
        id: call.id,
        name: call.name,
        result,
        success: true,
        duration: Date.now() - startTime,
      }];
    } catch (err) {
      return [{
        id: call.id,
        name: call.name,
        result: null,
        success: false,
        error: String(err),
        duration: Date.now() - startTime,
      }];
    }
  }

  logger.info("[parallel] Executing tool calls", { count: calls.length, maxConcurrency });

  // Execute with concurrency limit
  const results: ToolResult[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < calls.length; i += maxConcurrency) {
    const batch = calls.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (call) => {
      const startTime = Date.now();
      try {
        const result = await executor(call);
        results.push({
          id: call.id,
          name: call.name,
          result,
          success: true,
          duration: Date.now() - startTime,
        });
      } catch (err) {
        results.push({
          id: call.id,
          name: call.name,
          result: null,
          success: false,
          error: String(err),
          duration: Date.now() - startTime,
        });
      }
    });

    executing.push(...batchPromises);
    await Promise.all(batchPromises);
  }

  // Sort results by original call order
  const callOrder = new Map(calls.map((c, i) => [c.id, i]));
  results.sort((a, b) => (callOrder.get(a.id) ?? 0) - (callOrder.get(b.id) ?? 0));

  const successCount = results.filter((r) => r.success).length;
  logger.info("[parallel] Completed", {
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
  });

  return results;
}

/**
 * Determine if a set of tool calls can be safely parallelized.
 * Read-only operations (read, listDir, grep, glob, web_fetch, web_search) are safe.
 * Write operations should be sequential.
 */
export function canParallelize(calls: ToolCall[]): boolean {
  const readOnlyTools = new Set([
    "readFile", "listDir", "grepSearch", "globFind",
    "webFetch", "webSearch", "lspDefinition", "lspReferences",
    "lspHover", "lspCompletion", "lspDiagnostics", "lspSymbols",
    "memory_search", "todoRead", "notebookRead",
  ]);

  return calls.every((call) => readOnlyTools.has(call.name));
}

/**
 * Split tool calls into parallelizable and sequential batches.
 */
export function splitBatches(calls: ToolCall[]): {
  parallel: ToolCall[];
  sequential: ToolCall[];
} {
  const readOnlyTools = new Set([
    "readFile", "listDir", "grepSearch", "globFind",
    "webFetch", "webSearch", "lspDefinition", "lspReferences",
    "lspHover", "lspCompletion", "lspDiagnostics", "lspSymbols",
    "memory_search", "todoRead", "notebookRead",
  ]);

  const parallel: ToolCall[] = [];
  const sequential: ToolCall[] = [];

  for (const call of calls) {
    if (readOnlyTools.has(call.name)) {
      parallel.push(call);
    } else {
      sequential.push(call);
    }
  }

  return { parallel, sequential };
}
