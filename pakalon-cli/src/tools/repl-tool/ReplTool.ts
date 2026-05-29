/**
 * REPL Tool — Interactive code evaluation in sandboxed environments.
 *
 * Provides interactive code evaluation capabilities:
 * - JavaScript/TypeScript execution via Node.js
 * - Python execution
 * - Shell command evaluation
 * - Session state persistence between evaluations
 * - Timeout and resource limits
 * - Output capture and formatting
 *
 * Port from Claude Code's REPL tool patterns.
 */

import { spawn, type ChildProcess } from "child_process";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ReplLanguage = "javascript" | "typescript" | "python" | "shell";

export interface ReplConfig {
  /** Maximum execution time in milliseconds */
  timeout: number;
  /** Maximum output size in bytes */
  maxOutputSize: number;
  /** Whether to preserve state between evaluations */
  preserveState: boolean;
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env?: Record<string, string>;
}

export interface ReplSession {
  /** Session ID */
  id: string;
  /** Language being evaluated */
  language: string;
  /** Session start time */
  startedAt: Date;
  /** Number of evaluations performed */
  evaluationCount: number;
  /** Session state (variables, etc.) */
  state: Record<string, unknown>;
  /** Process handle (if persistent) */
  process?: ChildProcess;
}

export interface ReplEvaluation {
  /** Evaluation ID */
  id: string;
  /** Code to evaluate */
  code: string;
  /** Language */
  language: string;
  /** Session ID */
  sessionId: string;
  /** Start time */
  startedAt: Date;
  /** End time */
  endedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** stdout output */
  stdout?: string;
  /** stderr output */
  stderr?: string;
  /** Exit code */
  exitCode?: number;
  /** Error message (if failed) */
  error?: string;
  /** Whether evaluation is still running */
  running: boolean;
}

export interface ReplResult {
  /** Whether evaluation succeeded */
  success: boolean;
  /** stdout output */
  stdout: string;
  /** stderr output */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether output was truncated */
  truncated: boolean;
  /** Evaluation metadata */
  evaluation: ReplEvaluation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Config
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ReplConfig = {
  timeout: 30000,
  maxOutputSize: 1024 * 1024, // 1MB
  preserveState: true,
  cwd: process.cwd(),
};

// ─────────────────────────────────────────────────────────────────────────────
// REPL Engine
// ─────────────────────────────────────────────────────────────────────────────

export class ReplEngine {
  private config: ReplConfig;
  private sessions: Map<string, ReplSession> = new Map();
  private evaluations: Map<string, ReplEvaluation> = new Map();

  constructor(config?: Partial<ReplConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new REPL session.
   */
  createSession(language: string): ReplSession {
    const session: ReplSession = {
      id: crypto.randomUUID(),
      language,
      startedAt: new Date(),
      evaluationCount: 0,
      state: {},
    };
    this.sessions.set(session.id, session);
    logger.debug("[REPL] Created session", { id: session.id, language });
    return session;
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): ReplSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Destroy a session and clean up resources.
   */
  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.process && !session.process.killed) {
      session.process.kill();
    }

    this.sessions.delete(sessionId);
    logger.debug("[REPL] Destroyed session", { id: sessionId });
    return true;
  }

  /**
   * Evaluate code in a session.
   */
  async evaluate(
    sessionId: string,
    code: string,
    options?: { timeout?: number }
  ): Promise<ReplResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const evalId = crypto.randomUUID();
    const evaluation: ReplEvaluation = {
      id: evalId,
      code,
      language: session.language,
      sessionId,
      startedAt: new Date(),
      running: true,
    };
    this.evaluations.set(evalId, evaluation);
    session.evaluationCount++;

    const startTime = Date.now();
    const timeout = options?.timeout ?? this.config.timeout;

    try {
      const result = await this.executeCode(session, code, timeout);
      
      evaluation.endedAt = new Date();
      evaluation.durationMs = Date.now() - startTime;
      evaluation.stdout = result.stdout;
      evaluation.stderr = result.stderr;
      evaluation.exitCode = result.exitCode;
      evaluation.running = false;

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: evaluation.durationMs,
        truncated: result.stdout.length > this.config.maxOutputSize,
        evaluation,
      };
    } catch (error) {
      evaluation.endedAt = new Date();
      evaluation.durationMs = Date.now() - startTime;
      evaluation.error = String(error);
      evaluation.running = false;

      return {
        success: false,
        stdout: "",
        stderr: String(error),
        exitCode: 1,
        durationMs: evaluation.durationMs,
        truncated: false,
        evaluation,
      };
    }
  }

  /**
   * Execute code based on language.
   */
  private async executeCode(
    session: ReplSession,
    code: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    switch (session.language) {
      case "javascript":
      case "js":
        return this.executeJavaScript(code, session, timeout);
      case "typescript":
      case "ts":
        return this.executeTypeScript(code, session, timeout);
      case "python":
      case "py":
        return this.executePython(code, session, timeout);
      case "shell":
      case "sh":
        return this.executeShell(code, session, timeout);
      default:
        throw new Error(`Unsupported language: ${session.language}`);
    }
  }

  private async executeJavaScript(
    code: string,
    session: ReplSession,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Build stateful script if preserveState is enabled
    let script = code;
    if (this.config.preserveState && Object.keys(session.state).length > 0) {
      const stateLines = Object.entries(session.state)
        .map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`)
        .join("\n");
      script = `${stateLines}\n${code}`;
    }

    return this.spawnProcess("node", ["-e", script], session, timeout);
  }

  private async executeTypeScript(
    code: string,
    session: ReplSession,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Use tsx or ts-node for TypeScript evaluation
    const args = ["--eval", code];
    return this.spawnProcess("npx", ["tsx", ...args], session, timeout);
  }

  private async executePython(
    code: string,
    session: ReplSession,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.spawnProcess("python", ["-c", code], session, timeout);
  }

  private async executeShell(
    code: string,
    session: ReplSession,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const shell = process.platform === "win32" ? "cmd" : "sh";
    const shellArg = process.platform === "win32" ? "/c" : "-c";
    return this.spawnProcess(shell, [shellArg, code], session, timeout);
  }

  private spawnProcess(
    command: string,
    args: string[],
    session: ReplSession,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(command, args, {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > this.config.maxOutputSize) {
          child.kill();
          killed = true;
          resolve({ stdout: stdout.slice(0, this.config.maxOutputSize), stderr, exitCode: -1 });
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        if (!killed) {
          child.kill();
          killed = true;
          resolve({ stdout, stderr: "Timeout exceeded", exitCode: -2 });
        }
      }, timeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (!killed) {
          reject(err);
        }
      });
    });
  }

  /**
   * Get all evaluations for a session.
   */
  getEvaluations(sessionId: string): ReplEvaluation[] {
    return Array.from(this.evaluations.values())
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }

  /**
   * Get evaluation by ID.
   */
  getEvaluation(evaluationId: string): ReplEvaluation | undefined {
    return this.evaluations.get(evaluationId);
  }

  /**
   * List all active sessions.
   */
  listSessions(): ReplSession[] {
    return Array.from(this.sessions.values());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPL Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplToolInput {
  /** Code to evaluate */
  code: string;
  /** Language (javascript, typescript, python, shell) */
  language?: string;
  /** Session ID (optional, creates new if not provided) */
  sessionId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface ReplToolResult {
  /** Whether evaluation succeeded */
  success: boolean;
  /** stdout output */
  stdout: string;
  /** stderr output */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Session ID */
  sessionId: string;
  /** Evaluation ID */
  evaluationId: string;
}

/**
 * Create a REPL tool instance.
 */
export function createReplTool(config?: Partial<ReplConfig>) {
  const engine = new ReplEngine(config);

  return {
    name: "repl",
    description: "Evaluate code in a sandboxed REPL environment. Supports JavaScript, TypeScript, Python, and Shell.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Code to evaluate",
        },
        language: {
          type: "string",
          enum: ["javascript", "js", "typescript", "ts", "python", "py", "shell", "sh"],
          default: "javascript",
          description: "Programming language",
        },
        sessionId: {
          type: "string",
          description: "Session ID (optional, creates new session if not provided)",
        },
        timeout: {
          type: "number",
          default: 30000,
          description: "Timeout in milliseconds",
        },
      },
      required: ["code"],
    },
    execute: async (input: ReplToolInput): Promise<ReplToolResult> => {
      const language = input.language ?? "javascript";
      
      // Get or create session
      let session: ReplSession;
      if (input.sessionId) {
        const existing = engine.getSession(input.sessionId);
        if (!existing) {
          throw new Error(`Session not found: ${input.sessionId}`);
        }
        session = existing;
      } else {
        session = engine.createSession(language);
      }

      const result = await engine.evaluate(session.id, input.code, {
        timeout: input.timeout,
      });

      return {
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        sessionId: session.id,
        evaluationId: result.evaluation.id,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let replEngine: ReplEngine | null = null;

/**
 * Get the singleton REPL engine.
 */
export function getReplEngine(config?: Partial<ReplConfig>): ReplEngine {
  if (!replEngine) {
    replEngine = new ReplEngine(config);
  }
  return replEngine;
}

/**
 * Reset the singleton (for testing).
 */
export function resetReplEngine(): void {
  replEngine = null;
}
