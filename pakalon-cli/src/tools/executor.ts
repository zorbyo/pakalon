import { z } from "zod";
import logger from "@/utils/logger.js";

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
      _context?: ToolContext
    ): Promise<ExecutionResult> {
      const startTime = Date.now();
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await Promise.race([
            tool.execute(args),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout)
            ),
          ]);

          return {
            output: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            exitCode: 0,
            tool: tool.name,
            duration: Date.now() - startTime,
          };
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
          }
        }
      }

      return {
        output: "",
        error: lastError?.message ?? "Unknown error",
        exitCode: 2,
        tool: tool.name,
        duration: Date.now() - startTime,
      };
    },

    async executeStream<T extends z.ZodSchema>(
      tool: ToolDefinition<T>,
      args: z.infer<T>,
      onChunk: (chunk: string) => void,
      _context?: ToolContext
    ): Promise<ExecutionResult> {
      const startTime = Date.now();

      try {
        if (tool.executeStream) {
          await tool.executeStream(args, onChunk);
        } else {
          const result = await tool.execute(args);
          onChunk(typeof result === "string" ? result : JSON.stringify(result));
        }

        return {
          output: "",
          exitCode: 0,
          tool: tool.name,
          duration: Date.now() - startTime,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return {
          output: "",
          error: error.message,
          exitCode: 2,
          tool: tool.name,
          duration: Date.now() - startTime,
        };
      }
    },
  };
}
