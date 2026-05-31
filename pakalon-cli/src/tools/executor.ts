import { z } from "zod";
import logger from "@/utils/logger.js";
import { getToolHookManager } from "./tool-hooks.js";

export type PermissionState = "allow" | "deny" | "ask";

export interface ToolPermissionConfig {
  defaults: Record<string, PermissionState>;
  toolOverrides: Record<string, PermissionState>;
  sessionPermissions: Map<string, { state: PermissionState; expiresAt?: Date }>;
}

export interface PermissionCheck {
  tool: string;
  args: Record<string, unknown>;
  state: PermissionState;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;

export interface ToolExecutorConfig {
  timeout?: number;
  maxRetries?: number;
  verboseOnError?: boolean;
}

export interface ExecutionResult {
  output: string;
  error?: string;
  exitCode: number;
  tool: string;
  duration: number;
}

export interface ToolDefinition<T extends z.ZodSchema = z.ZodSchema> {
  name: string;
  description: string;
  parameters: T;
  requiresPermission?: boolean;
  execute: (args: z.infer<T>) => Promise<unknown>;
  executeStream?: (args: z.infer<T>, onChunk: (chunk: string) => void) => Promise<unknown>;
}

export interface ToolContext {
  cwd: string;
  homeDir: string;
  env: Record<string, string>;
}

export function handleExitCode(
  exitCode: number,
  stdout: string,
  stderr: string
): { output: string; error?: string; exitCode: number } {
  switch (exitCode) {
    case 0:
      return { output: stdout, exitCode: 0 };
    case 2:
      return { output: "", error: stderr, exitCode: 2 };
    default:
      return { output: stdout, error: stderr, exitCode };
  }
}

export function createToolExecutor(config: ToolExecutorConfig = {}) {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const verboseOnError = config.verboseOnError ?? true;

  return {
    timeout,
    maxRetries,
    verboseOnError,

    async execute<T extends z.ZodSchema>(
      tool: ToolDefinition<T>,
      args: z.infer<T>,
      _context?: ToolContext,
      sessionId?: string,
      agentId?: string
    ): Promise<ExecutionResult> {
      const startTime = Date.now();
      let lastError: Error | null = null;
      const hookManager = getToolHookManager();

      // Run beforeToolCall hooks
      const beforeResult = await hookManager.runBeforeToolCall({
        toolName: tool.name,
        args: args as Record<string, unknown>,
        sessionId,
        agentId,
        timestamp: startTime,
      });

      // Check if hook denied execution
      if (beforeResult.action === 'deny') {
        return {
          output: "",
          error: beforeResult.reason ?? "Tool call denied by hook",
          exitCode: 2,
          tool: tool.name,
          duration: Date.now() - startTime,
        };
      }

      // Use modified args if provided
      const finalArgs = beforeResult.action === 'modify' && beforeResult.modifiedArgs
        ? beforeResult.modifiedArgs as z.infer<T>
        : args;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await Promise.race([
            tool.execute(finalArgs),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout)
            ),
          ]);

          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          const duration = Date.now() - startTime;

          // Run afterToolCall hooks
          const afterResult = await hookManager.runAfterToolCall({
            toolName: tool.name,
            args: finalArgs as Record<string, unknown>,
            result,
            isError: false,
            durationMs: duration,
            sessionId,
            agentId,
            timestamp: startTime,
          });

          return {
            output: afterResult.result !== undefined
              ? (typeof afterResult.result === "string" ? afterResult.result : JSON.stringify(afterResult.result, null, 2))
              : output,
            exitCode: 0,
            tool: tool.name,
            duration,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
          }
        }
      }

      const errorDuration = Date.now() - startTime;

      // Run afterToolCall hooks for error case
      await hookManager.runAfterToolCall({
        toolName: tool.name,
        args: finalArgs as Record<string, unknown>,
        result: null,
        isError: true,
        durationMs: errorDuration,
        sessionId,
        agentId,
        timestamp: startTime,
      });

      return {
        output: "",
        error: lastError?.message ?? "Unknown error",
        exitCode: 2,
        tool: tool.name,
        duration: errorDuration,
      };
    },

    async executeStream<T extends z.ZodSchema>(
      tool: ToolDefinition<T>,
      args: z.infer<T>,
      onChunk: (chunk: string) => void,
      _context?: ToolContext,
      sessionId?: string,
      agentId?: string
    ): Promise<ExecutionResult> {
      const startTime = Date.now();
      const hookManager = getToolHookManager();

      // Run beforeToolCall hooks
      const beforeResult = await hookManager.runBeforeToolCall({
        toolName: tool.name,
        args: args as Record<string, unknown>,
        sessionId,
        agentId,
        timestamp: startTime,
      });

      // Check if hook denied execution
      if (beforeResult.action === 'deny') {
        return {
          output: "",
          error: beforeResult.reason ?? "Tool call denied by hook",
          exitCode: 2,
          tool: tool.name,
          duration: Date.now() - startTime,
        };
      }

      // Use modified args if provided
      const finalArgs = beforeResult.action === 'modify' && beforeResult.modifiedArgs
        ? beforeResult.modifiedArgs as z.infer<T>
        : args;

      try {
        let result: unknown;
        if (tool.executeStream) {
          await tool.executeStream(finalArgs, onChunk);
        } else {
          result = await tool.execute(finalArgs);
          onChunk(typeof result === "string" ? result : JSON.stringify(result));
        }

        const duration = Date.now() - startTime;

        // Run afterToolCall hooks
        await hookManager.runAfterToolCall({
          toolName: tool.name,
          args: finalArgs as Record<string, unknown>,
          result: result ?? null,
          isError: false,
          durationMs: duration,
          sessionId,
          agentId,
          timestamp: startTime,
        });

        return {
          output: "",
          exitCode: 0,
          tool: tool.name,
          duration,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const duration = Date.now() - startTime;

        // Run afterToolCall hooks for error case
        await hookManager.runAfterToolCall({
          toolName: tool.name,
          args: finalArgs as Record<string, unknown>,
          result: null,
          isError: true,
          durationMs: duration,
          sessionId,
          agentId,
          timestamp: startTime,
        });

        return {
          output: "",
          error: error.message,
          exitCode: 2,
          tool: tool.name,
          duration,
        };
      }
    },
  };
}
