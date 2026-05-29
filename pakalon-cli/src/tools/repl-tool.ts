/**
 * REPL Tool for Pakalon CLI
 * 
 * Interactive REPL (Read-Eval-Print-Loop) support for multiple languages.
 * Features:
 * - Node.js REPL with VM context
 * - Python REPL
 * - Persistent context across evaluations
 * - Safe execution with timeout
 */

import * as vm from "vm";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface REPLContext {
  id: string;
  language: "javascript" | "typescript" | "python";
  globals: Record<string, unknown>;
  history: Array<{ input: string; output: string; timestamp: number }>;
  createdAt: number;
  lastUsed: number;
}

export interface REPLResult {
  success: boolean;
  output?: string;
  error?: string;
  type?: string;
  executionTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_OUTPUT_LENGTH = 50000;
const MAX_HISTORY_ENTRIES = 100;

// ---------------------------------------------------------------------------
// REPL Context Storage
// ---------------------------------------------------------------------------

const replContexts: Map<string, REPLContext> = new Map();
const vmContexts: Map<string, vm.Context> = new Map();

export function createREPLContext(
  id: string,
  language: "javascript" | "typescript" | "python"
): REPLContext {
  const context: REPLContext = {
    id,
    language,
    globals: {},
    history: [],
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };
  
  replContexts.set(id, context);

  // Create VM context for JavaScript/TypeScript
  if (language === "javascript" || language === "typescript") {
    const vmContext = vm.createContext({
      console: {
        log: (...args: unknown[]) => args.map(String).join(" "),
        error: (...args: unknown[]) => args.map(String).join(" "),
        warn: (...args: unknown[]) => args.map(String).join(" "),
        info: (...args: unknown[]) => args.map(String).join(" "),
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Buffer,
      process: {
        env: { ...process.env },
        cwd: () => process.cwd(),
        platform: process.platform,
        arch: process.arch,
        version: process.version,
      },
      require: (module: string) => {
        // Limited require for safety
        const allowedModules = ["path", "url", "util", "querystring", "crypto"];
        if (allowedModules.includes(module)) {
          return require(module);
        }
        throw new Error(`Module '${module}' is not available in REPL`);
      },
      __pakalon: {
        version: "1.0.0",
        contextId: id,
      },
    });
    
    vmContexts.set(id, vmContext);
  }

  logger.debug(`[repl] Created ${language} REPL context: ${id}`);
  return context;
}

export function getREPLContext(id: string): REPLContext | null {
  return replContexts.get(id) ?? null;
}

export function deleteREPLContext(id: string): boolean {
  replContexts.delete(id);
  vmContexts.delete(id);
  return true;
}

export function listREPLContexts(): REPLContext[] {
  return Array.from(replContexts.values());
}

// ---------------------------------------------------------------------------
// JavaScript/TypeScript Evaluation
// ---------------------------------------------------------------------------

function evaluateJavaScript(
  code: string,
  contextId: string,
  timeout: number = DEFAULT_TIMEOUT_MS
): REPLResult {
  const startTime = Date.now();
  
  let vmContext = vmContexts.get(contextId);
  if (!vmContext) {
    // Create new context if doesn't exist
    createREPLContext(contextId, "javascript");
    vmContext = vmContexts.get(contextId)!;
  }

  try {
    const script = new vm.Script(code, {
      filename: `repl-${contextId}.js`,
      lineOffset: 0,
      columnOffset: 0,
    });

    const result = script.runInContext(vmContext, {
      timeout,
      displayErrors: true,
    });

    const output = formatOutput(result);
    const executionTimeMs = Date.now() - startTime;

    // Update context history
    const replContext = replContexts.get(contextId);
    if (replContext) {
      replContext.lastUsed = Date.now();
      replContext.history.push({
        input: code,
        output,
        timestamp: Date.now(),
      });
      
      // Trim history if too long
      if (replContext.history.length > MAX_HISTORY_ENTRIES) {
        replContext.history = replContext.history.slice(-MAX_HISTORY_ENTRIES);
      }
    }

    return {
      success: true,
      output,
      type: typeof result,
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.debug(`[repl] JavaScript error: ${errorMessage}`);

    return {
      success: false,
      error: errorStack ?? errorMessage,
      executionTimeMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Python Evaluation (DEPRECATED — Python has been removed)
// ---------------------------------------------------------------------------

async function evaluatePython(
  _code: string,
  _contextId: string,
  _timeout: number = DEFAULT_TIMEOUT_MS
): Promise<REPLResult> {
  return {
    success: false,
    error: "Python execution has been removed from Pakalon.",
executionTimeMs: 0,
  };
}

// ---------------------------------------------------------------------------
// REPL Context Management

// ---------------------------------------------------------------------------
// Output Formatting
// ---------------------------------------------------------------------------

function formatOutput(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  try {
    if (typeof value === "object") {
      const formatted = JSON.stringify(value, null, 2);
      return formatted.length > MAX_OUTPUT_LENGTH
        ? formatted.slice(0, MAX_OUTPUT_LENGTH) + "\n... [truncated]"
        : formatted;
    }

    const str = String(value);
    return str.length > MAX_OUTPUT_LENGTH
      ? str.slice(0, MAX_OUTPUT_LENGTH) + "... [truncated]"
      : str;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const replToolSchema = z.object({
  action: z.enum(["eval", "create", "delete", "list", "history"])
    .describe("Action to perform"),
  contextId: z.string().optional()
    .describe("REPL context ID (auto-generated if not provided)"),
  language: z.enum(["javascript", "typescript", "python"]).optional()
    .default("javascript")
    .describe("Programming language for the REPL"),
  code: z.string().optional()
    .describe("Code to evaluate (required for 'eval' action)"),
  timeout: z.number().optional()
    .describe("Execution timeout in milliseconds"),
});

export type REPLToolInput = z.infer<typeof replToolSchema>;

export interface REPLToolOutput {
  success: boolean;
  action: string;
  contextId?: string;
  result?: REPLResult;
  contexts?: REPLContext[];
  history?: Array<{ input: string; output: string; timestamp: number }>;
  error?: string;
}

export async function executeREPLTool(input: REPLToolInput): Promise<REPLToolOutput> {
  const { action, contextId, language = "javascript", code, timeout = DEFAULT_TIMEOUT_MS } = input;
  const effectiveContextId = contextId ?? `repl-${Date.now()}`;

  switch (action) {
    case "create": {
      const context = createREPLContext(effectiveContextId, language);
      return {
        success: true,
        action,
        contextId: context.id,
      };
    }

    case "delete": {
      if (!contextId) {
        return {
          success: false,
          action,
          error: "contextId is required for delete action",
        };
      }
      deleteREPLContext(contextId);
      return {
        success: true,
        action,
        contextId,
      };
    }

    case "list": {
      return {
        success: true,
        action,
        contexts: listREPLContexts(),
      };
    }

    case "history": {
      if (!contextId) {
        return {
          success: false,
          action,
          error: "contextId is required for history action",
        };
      }
      const context = getREPLContext(contextId);
      if (!context) {
        return {
          success: false,
          action,
          error: `Context ${contextId} not found`,
        };
      }
      return {
        success: true,
        action,
        contextId,
        history: context.history,
      };
    }

    case "eval": {
      if (!code) {
        return {
          success: false,
          action,
          error: "code is required for eval action",
        };
      }

      // Get or create context
      let context = getREPLContext(effectiveContextId);
      if (!context) {
        context = createREPLContext(effectiveContextId, language);
      }

      let result: REPLResult;
      if (context.language === "python") {
        result = {
          success: false,
          error: "Python evaluation has been removed from Pakalon. Use JavaScript or TypeScript instead.",
          executionTimeMs: 0,
        };
      } else {
        result = evaluateJavaScript(code, effectiveContextId, timeout);
      }

      return {
        success: result.success,
        action,
        contextId: effectiveContextId,
        result,
      };
    }

    default:
      return {
        success: false,
        action,
        error: `Unknown action: ${action}`,
      };
  }
}

export const replToolDefinition = {
  name: "repl",
  description: "Interactive REPL for JavaScript/TypeScript/Python code evaluation",
  inputSchema: replToolSchema,

  async execute(input: REPLToolInput): Promise<REPLToolOutput> {
    return executeREPLTool(input);
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  replToolSchema,
  replToolDefinition,
  executeREPLTool,
  createREPLContext,
  getREPLContext,
  deleteREPLContext,
  listREPLContexts,
};
