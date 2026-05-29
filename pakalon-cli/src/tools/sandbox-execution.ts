import * as fs from "fs/promises";
import { fork } from "child_process";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { debugLog } from "@/utils/logger.js";

export interface SandboxSecurityPolicy {
  allowedCommands: string[];
  disallowedPatterns: string[];
  maxFileSize: number;
}

export interface SandboxExecutorConfig {
  timeout?: number;
  memoryLimit?: number;
  cpuTimeLimit?: number;
  security?: Partial<SandboxSecurityPolicy>;
}

export interface SandboxExecutionOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  memoryLimit?: number;
  cpuTimeLimit?: number;
  maxFileSize?: number;
}

export interface SandboxResourceUsage {
  userCPUTimeMs: number;
  systemCPUTimeMs: number;
  maxRSSKb: number;
  memoryBytes: number;
}

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  resourceUsage: SandboxResourceUsage;
  sandboxId: string;
  error?: string;
}

export interface SandboxSession {
  sandboxId: string;
  workspaceDir: string;
  tempDir: string;
  workerPath: string;
  createdAt: string;
  policy: SandboxSecurityPolicy;
}

interface SessionRecord extends SandboxSession {
  destroyed: boolean;
}

interface WorkerResultMessage {
  type: "result";
  result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    resourceUsage: SandboxResourceUsage;
    error?: string;
  };
}

interface WorkerErrorMessage {
  type: "error";
  error: string;
}

type WorkerMessage = WorkerResultMessage | WorkerErrorMessage;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
const DEFAULT_CPU_TIME_LIMIT_MS = 10_000;
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const DEFAULT_DISALLOWED_PATTERNS = [
  String.raw`\brm\s+-rf\b`,
  String.raw`\bdel\s+/s\b`,
  String.raw`\bformat\b`,
  String.raw`\bshutdown\b`,
  String.raw`\bmkfs\b`,
  String.raw`\bcurl\b.*\|\s*(?:ba)?sh\b`,
  String.raw`\bwget\b.*\|\s*(?:ba)?sh\b`,
];

const PASSTHROUGH_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
];

const sessions = new Map<string, SessionRecord>();

function normalizeCommandName(command: string): string {
  const base = path.basename(command).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function toRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&"), "i");
  }
}

function createDefaultPolicy(): SandboxSecurityPolicy {
  return {
    allowedCommands: [],
    disallowedPatterns: [...DEFAULT_DISALLOWED_PATTERNS],
    maxFileSize: DEFAULT_MAX_FILE_SIZE_BYTES,
  };
}

function mergePolicy(policy?: Partial<SandboxSecurityPolicy>): SandboxSecurityPolicy {
  const base = createDefaultPolicy();
  return {
    allowedCommands: policy?.allowedCommands ? [...policy.allowedCommands] : base.allowedCommands,
    disallowedPatterns: policy?.disallowedPatterns ? [...policy.disallowedPatterns] : base.disallowedPatterns,
    maxFileSize: policy?.maxFileSize ?? base.maxFileSize,
  };
}

function mergeEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      env[key] = value;
    }
  }
  return env;
}

function isAllowedCommand(command: string, allowedCommands: string[]): boolean {
  if (allowedCommands.length === 0) {
    return true;
  }

  const normalized = normalizeCommandName(command);
  return allowedCommands.some((allowed) => {
    const candidate = normalizeCommandName(allowed);
    return candidate === normalized || allowed === command;
  });
}

function detectDisallowedPattern(commandLine: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    const regex = toRegExp(pattern);
    if (regex.test(commandLine)) {
      return pattern;
    }
  }
  return null;
}

function buildWorkerSource(): string {
  return [
    'const { spawn } = require("child_process");',
    'const fs = require("fs/promises");',
    'const path = require("path");',
    '',
    'const OUTPUT_LIMIT = 1024 * 1024;',
    '',
    'function clampText(value, limit) {',
    '  return value.length <= limit ? value : value.slice(0, limit);',
    '}',
    '',
    'async function walkFileSizes(rootDir, maxFileSize) {',
    '  const entries = await fs.readdir(rootDir, { withFileTypes: true });',
    '  for (const entry of entries) {',
    '    const fullPath = path.join(rootDir, entry.name);',
    '    if (entry.isDirectory()) {',
    '      const exceeded = await walkFileSizes(fullPath, maxFileSize);',
    '      if (exceeded) return exceeded;',
    '      continue;',
    '    }',
    '    if (entry.isFile()) {',
    '      const stats = await fs.stat(fullPath);',
    '      if (stats.size > maxFileSize) return fullPath;',
    '    }',
    '  }',
    '  return null;',
    '}',
    '',
    'process.on("message", (message) => {',
    '  if (!message || message.type !== "execute") return;',
    '',
    '  const command = message.command;',
    '  const args = message.args;',
    '  const cwd = message.cwd;',
    '  const env = message.env;',
    '  const timeout = message.timeout;',
    '  const memoryLimit = message.memoryLimit;',
    '  const cpuTimeLimit = message.cpuTimeLimit;',
    '  const maxFileSize = message.maxFileSize;',
    '  const rootDir = message.rootDir;',
    '',
    '  let stdout = "";',
    '  let stderr = "";',
    '  let finished = false;',
    '  let timedOut = false;',
    '  let child = null;',
    '  const startCpu = process.cpuUsage();',
    '',
    '  const finalize = (exitCode, error) => {',
    '    if (finished) return;',
    '    finished = true;',
    '    const cpu = process.cpuUsage(startCpu);',
    '    const result = {',
    '      exitCode,',
    '      stdout: clampText(stdout, OUTPUT_LIMIT),',
    '      stderr: clampText(stderr, OUTPUT_LIMIT),',
    '      resourceUsage: {',
    '        userCPUTimeMs: Math.round(cpu.user / 1000),',
    '        systemCPUTimeMs: Math.round(cpu.system / 1000),',
    '        maxRSSKb: process.resourceUsage().maxRSS,',
    '        memoryBytes: process.memoryUsage().rss,',
    '      },',
    '      error,',
    '    };',
    '    if (process.send) {',
    '      process.send({ type: "result", result }, () => process.exit(exitCode));',
    '      return;',
    '    }',
    '    process.exit(exitCode);',
    '  };',
    '',
    '  const killChild = (signal) => {',
    '    if (!child || child.killed) return;',
    '    try {',
    '      child.kill(signal);',
    '    } catch {}',
    '  };',
    '',
    '  const enforceLimits = async () => {',
    '    if (finished) return;',
    '    const currentMemory = process.memoryUsage().rss;',
    '    if (typeof memoryLimit === "number" && memoryLimit > 0 && currentMemory > memoryLimit) {',
    '      stderr += "Sandbox memory limit exceeded (" + currentMemory + " > " + memoryLimit + ")\\n";',
    '      killChild("SIGKILL");',
    '      finalize(137, "Memory limit exceeded");',
    '      return;',
    '    }',
    '    const cpu = process.cpuUsage(startCpu);',
    '    const cpuMs = Math.round((cpu.user + cpu.system) / 1000);',
    '    if (typeof cpuTimeLimit === "number" && cpuTimeLimit > 0 && cpuMs > cpuTimeLimit) {',
    '      stderr += "Sandbox CPU limit exceeded (" + cpuMs + "ms > " + cpuTimeLimit + "ms)\\n";',
    '      killChild("SIGKILL");',
    '      finalize(137, "CPU limit exceeded");',
    '      return;',
    '    }',
    '    if (typeof maxFileSize === "number" && maxFileSize > 0 && rootDir) {',
    '      try {',
    '        const exceeded = await walkFileSizes(rootDir, maxFileSize);',
    '        if (exceeded) {',
    '          stderr += "Sandbox file size limit exceeded: " + exceeded + "\\n";',
    '          killChild("SIGKILL");',
    '          finalize(137, "File size limit exceeded");',
    '        }',
    '      } catch (err) {',
    '        stderr += "Sandbox file scan failed: " + (err && err.message ? err.message : String(err)) + "\\n";',
    '      }',
    '    }',
    '  };',
    '',
    '  child = spawn(command, args, {',
    '    cwd,',
    '    env,',
    '    shell: false,',
    '    stdio: ["ignore", "pipe", "pipe"],',
    '    windowsHide: true,',
    '  });',
    '',
    '  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });',
    '  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });',
    '  child.on("error", (err) => {',
    '    stderr += err.message + "\\n";',
    '    finalize(1, err.message);',
    '  });',
    '  child.on("close", (code, signal) => {',
    '    const exitCode = typeof code === "number" ? code : signal === "SIGKILL" ? 137 : 1;',
    '    if (timedOut) stderr += "Sandbox timeout after " + timeout + "ms\\n";',
    '    finalize(exitCode, timedOut ? "Execution timed out" : undefined);',
    '  });',
    '',
    '  if (typeof timeout === "number" && timeout > 0) {',
    '    setTimeout(() => {',
    '      timedOut = true;',
    '      stderr += "Sandbox timeout after " + timeout + "ms\\n";',
    '      killChild("SIGTERM");',
    '      setTimeout(() => killChild("SIGKILL"), 2000).unref?.();',
    '    }, timeout).unref?.();',
    '  }',
    '',
    '  if (typeof maxFileSize === "number" && maxFileSize > 0 && rootDir) {',
    '    const fileTimer = setInterval(() => { void enforceLimits(); }, 500);',
    '    fileTimer.unref?.();',
    '  }',
    '  if (typeof memoryLimit === "number" && memoryLimit > 0) {',
    '    const memoryTimer = setInterval(() => { void enforceLimits(); }, 250);',
    '    memoryTimer.unref?.();',
    '  }',
    '  if (typeof cpuTimeLimit === "number" && cpuTimeLimit > 0) {',
    '    const cpuTimer = setInterval(() => { void enforceLimits(); }, 250);',
    '    cpuTimer.unref?.();',
    '  }',
    '});',
    '',
  ].join("\n");
}

async function ensureSessionDir(workspaceDir: string): Promise<{ sandboxId: string; tempDir: string; workerPath: string }> {
  const sandboxId = randomUUID();
  const tempDir = path.join(os.tmpdir(), "pakalon-sandbox", sandboxId);
  await fs.mkdir(tempDir, { recursive: true });
  const workerPath = path.join(tempDir, "sandbox-worker.cjs");
  await fs.writeFile(workerPath, buildWorkerSource(), "utf8");
  const manifestPath = path.join(tempDir, "sandbox-session.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ sandboxId, workspaceDir: path.resolve(workspaceDir), createdAt: new Date().toISOString() }, null, 2),
    "utf8",
  );
  return { sandboxId, tempDir, workerPath };
}

async function removeSessionDir(tempDir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
}
function toMessageError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "Unknown sandbox error";
}

export class SandboxedExecutor {
  private readonly config: Required<SandboxExecutorConfig>;

  public constructor(config: SandboxExecutorConfig = {}) {
    this.config = {
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      memoryLimit: config.memoryLimit ?? DEFAULT_MEMORY_LIMIT_BYTES,
      cpuTimeLimit: config.cpuTimeLimit ?? DEFAULT_CPU_TIME_LIMIT_MS,
      security: mergePolicy(config.security),
    };
  }

  public static isSandboxSupported(): boolean {
    return process.platform === "darwin" || process.platform === "linux" || process.platform === "win32";
  }

  public static getDefaultConfig(): Required<SandboxExecutorConfig> {
    return {
      timeout: DEFAULT_TIMEOUT_MS,
      memoryLimit: DEFAULT_MEMORY_LIMIT_BYTES,
      cpuTimeLimit: DEFAULT_CPU_TIME_LIMIT_MS,
      security: createDefaultPolicy(),
    };
  }

  public async createSandboxSession(workspaceDir: string, options: Partial<SandboxExecutorConfig> = {}): Promise<SandboxSession> {
    const resolvedWorkspaceDir = path.resolve(workspaceDir);
    const workspaceStats = await fs.stat(resolvedWorkspaceDir);
    if (!workspaceStats.isDirectory()) {
      throw new Error(`Workspace must be a directory: ${resolvedWorkspaceDir}`);
    }

    const { sandboxId, tempDir, workerPath } = await ensureSessionDir(resolvedWorkspaceDir);
    const session: SessionRecord = {
      sandboxId,
      workspaceDir: resolvedWorkspaceDir,
      tempDir,
      workerPath,
      createdAt: new Date().toISOString(),
      policy: mergePolicy(options.security ?? this.config.security),
      destroyed: false,
    };

    sessions.set(sandboxId, session);
    debugLog("[sandbox] session created", { sandboxId, workspaceDir: resolvedWorkspaceDir, tempDir });
    return {
      sandboxId: session.sandboxId,
      workspaceDir: session.workspaceDir,
      tempDir: session.tempDir,
      workerPath: session.workerPath,
      createdAt: session.createdAt,
      policy: session.policy,
    };
  }

  public async destroySandboxSession(sandboxId: string): Promise<boolean> {
    const session = sessions.get(sandboxId);
    if (!session || session.destroyed) {
      return false;
    }

    session.destroyed = true;
    sessions.delete(sandboxId);
    debugLog("[sandbox] session destroyed", { sandboxId, tempDir: session.tempDir });
    await removeSessionDir(session.tempDir);
    return true;
  }

  public async executeInSandbox(
    sandboxId: string,
    command: string,
    args: string[] = [],
    options: SandboxExecutionOptions = {},
  ): Promise<SandboxExecutionResult> {
    const session = sessions.get(sandboxId);
    if (!session || session.destroyed) {
      throw new Error(`Sandbox session not found: ${sandboxId}`);
    }

    const commandLine = [command, ...args].join(" ");
    const disallowedPattern = detectDisallowedPattern(commandLine, session.policy.disallowedPatterns);
    if (disallowedPattern) {
      return {
        exitCode: 126,
        stdout: "",
        stderr: `Blocked by sandbox policy: ${disallowedPattern}`,
        duration: 0,
        resourceUsage: {
          userCPUTimeMs: 0,
          systemCPUTimeMs: 0,
          maxRSSKb: 0,
          memoryBytes: 0,
        },
        sandboxId,
        error: "Disallowed command pattern",
      };
    }

    if (!isAllowedCommand(command, session.policy.allowedCommands)) {
      return {
        exitCode: 126,
        stdout: "",
        stderr: `Blocked by sandbox policy: command not allowed (${command})`,
        duration: 0,
        resourceUsage: {
          userCPUTimeMs: 0,
          systemCPUTimeMs: 0,
          maxRSSKb: 0,
          memoryBytes: 0,
        },
        sandboxId,
        error: "Command not allowed",
      };
    }

    const timeout = options.timeout ?? this.config.timeout;
    const memoryLimit = options.memoryLimit ?? this.config.memoryLimit;
    const cpuTimeLimit = options.cpuTimeLimit ?? this.config.cpuTimeLimit;
    const maxFileSize = options.maxFileSize ?? session.policy.maxFileSize;
    const requestedCwd = options.cwd ? path.resolve(session.tempDir, options.cwd) : session.tempDir;
    const cwd = requestedCwd.startsWith(session.tempDir) ? requestedCwd : session.tempDir;
    const env = mergeEnv(options.env);

    debugLog("[sandbox] execution started", {
      sandboxId,
      command,
      args,
      cwd,
      timeout,
      memoryLimit,
      cpuTimeLimit,
      maxFileSize,
    });

    const startedAt = Date.now();
    const worker = fork(session.workerPath, [], {
      cwd: session.tempDir,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    let settled = false;
    let parentStdout = "";
    let parentStderr = "";

    worker.stdout?.on("data", (chunk: Buffer | string) => {
      parentStdout += chunk.toString();
    });
    worker.stderr?.on("data", (chunk: Buffer | string) => {
      parentStderr += chunk.toString();
    });

    return await new Promise<SandboxExecutionResult>((resolve) => {
      const parentTimeout = setTimeout(() => {
        if (settled) return;
        try {
          worker.kill("SIGTERM");
        } catch {
          // ignore
        }
        finish({
          exitCode: 124,
          stdout: parentStdout,
          stderr: parentStderr || `Sandbox timeout after ${timeout}ms`,
          duration: Date.now() - startedAt,
          resourceUsage: {
            userCPUTimeMs: 0,
            systemCPUTimeMs: 0,
            maxRSSKb: 0,
            memoryBytes: 0,
          },
          sandboxId,
          error: "Execution timed out",
        });
      }, timeout);

      const finish = (result: SandboxExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(parentTimeout);
        debugLog("[sandbox] execution finished", {
          sandboxId,
          exitCode: result.exitCode,
          duration: result.duration,
        });
        resolve(result);
      };

      const fail = (error: string): void => {
        finish({
          exitCode: 1,
          stdout: parentStdout,
          stderr: parentStderr || error,
          duration: Date.now() - startedAt,
          resourceUsage: {
            userCPUTimeMs: 0,
            systemCPUTimeMs: 0,
            maxRSSKb: 0,
            memoryBytes: 0,
          },
          sandboxId,
          error,
        });
      };

      worker.once("message", (message: WorkerMessage) => {
        if (message.type === "result") {
          const result = message.result;
          finish({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration: Date.now() - startedAt,
            resourceUsage: result.resourceUsage,
            sandboxId,
            error: result.error,
          });
          return;
        }

        fail(message.error);
      });

      worker.once("error", (error: Error) => {
        fail(error.message);
      });

      worker.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }

        const exitCode = typeof code === "number" ? code : signal === "SIGTERM" ? 124 : 1;
        fail(`Sandbox worker exited unexpectedly (${exitCode})`);
      });

      const message = {
        type: "execute" as const,
        command,
        args,
        cwd,
        env,
        timeout,
        memoryLimit,
        cpuTimeLimit,
        maxFileSize,
        rootDir: session.tempDir,
      };

      worker.send(message, (error) => {
        if (!error) {
          return;
        }
        fail(toMessageError(error));
      });
    });
  }
}

const defaultSandboxExecutor = new SandboxedExecutor();

export async function createSandboxSession(
  workspaceDir: string,
  options?: Partial<SandboxExecutorConfig>,
): Promise<SandboxSession> {
  return defaultSandboxExecutor.createSandboxSession(workspaceDir, options);
}

export async function destroySandboxSession(sandboxId: string): Promise<boolean> {
  return defaultSandboxExecutor.destroySandboxSession(sandboxId);
}

export async function executeInSandbox(
  sandboxId: string,
  command: string,
  args: string[] = [],
  options: SandboxExecutionOptions = {},
): Promise<SandboxExecutionResult> {
  return defaultSandboxExecutor.executeInSandbox(sandboxId, command, args, options);
}

export function getDefaultSandboxExecutorConfig(): Required<SandboxExecutorConfig> {
  return SandboxedExecutor.getDefaultConfig();
}

export default SandboxedExecutor;
