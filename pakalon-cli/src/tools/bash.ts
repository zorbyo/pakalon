/**
 * PTY-based async bash execution — replaces execSync in ai/tools.ts.
 * Matches Copilot CLI's conpty.node approach using node-pty.
 *
 * Features:
 * - PTY-based execution (no event loop blocking)
 * - Streaming output support
 * - Configurable timeout
 * - Persistent working directory across calls
 * - Safe command detection (auto-approve read-only commands)
 * - Dangerous pattern detection (command substitution, variable expansion, UNC paths)
 * - Self-kill prevention
 * - Windows ARM64 support via node-pty
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";
import { checkDestructiveCommand } from "./bash/destructiveCommandWarning.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BashOptions {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  duration: number;
  timedOut: boolean;
}

// ---------------------------------------------------------------------------
// Safe Command Detection
// ---------------------------------------------------------------------------

const SAFE_COMMAND_PREFIXES = [
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "which",
  "where",
  "pwd",
  "echo",
  "date",
  "whoami",
  "hostname",
  "uname",
  "env",
  "printenv",
  "wc",
  "sort",
  "uniq",
  "diff",
  "tree",
  "file",
  "stat",
  "realpath",
  "basename",
  "dirname",
  "rg",
  "bat",
  "jq",
  "yq",
  "tee",
  "hexdump",
  "od",
  "strings",
  "nl",
  "fold",
  "tr",
  "cut",
  "awk",
  "sed",
  "xargs",
];

const SAFE_GIT_COMMANDS = [
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git show",
  "git blame",
  "git remote",
  "git tag",
  "git stash list",
  "git reflog",
  "git describe",
];

/**
 * Check if a command is safe (read-only) and can be auto-approved.
 */
export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();

  // Check safe git commands
  for (const safeGit of SAFE_GIT_COMMANDS) {
    if (trimmed === safeGit || trimmed.startsWith(safeGit + " ")) {
      return true;
    }
  }

  // Check safe command prefixes
  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (SAFE_COMMAND_PREFIXES.includes(firstToken)) {
    // Must not contain output redirection
    if (/[>]/.test(trimmed) || /\|\s*tee\b/.test(trimmed)) {
      return false;
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Dangerous Pattern Detection
// ---------------------------------------------------------------------------

export interface DangerousPattern {
  pattern: string;
  description: string;
  match: string;
}

const DANGEROUS_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /\$\([^)]*\)/g, description: "Command substitution $(...)" },
  { regex: /`[^`]+`/g, description: "Backtick substitution `...`" },
  { regex: /\$\{[^}]+\}/g, description: "Variable expansion ${VAR}" },
  { regex: /\\\\[a-zA-Z]+\\[a-zA-Z]/g, description: "UNC path \\\\server\\share" },
  { regex: /\bsudo\b/g, description: "sudo command" },
  { regex: /\brm\s+-rf\s+[\/~]/g, description: "rm -rf on root or home" },
  { regex: /\brm\s+-rf\b/g, description: "recursive force delete" },
  { regex: /\brmdir\b/g, description: "directory delete" },
  { regex: /\bdel\b/g, description: "Windows delete command" },
  { regex: /\bchmod\s+777\b/g, description: "chmod 777 (world-writable)" },
  { regex: /\bchown\b/g, description: "ownership change" },
  { regex: /\bcurl\b.*\|\s*(ba)?sh\b/g, description: "curl | bash (pipe to shell)" },
  { regex: /\bwget\b.*\|\s*(ba)?sh\b/g, description: "wget | sh (pipe to shell)" },
  { regex: /\bdd\s+if=/g, description: "dd command (raw disk write)" },
  { regex: /\bmkfs\b/g, description: "mkfs (format filesystem)" },
  { regex: /\bkillall\b/g, description: "killall command" },
];

export function getDestructiveWarnings(command: string): string[] {
  const warnings = new Set<string>();

  const destructive = checkDestructiveCommand(command);
  if (destructive) {
    warnings.add(`${destructive.severity.toUpperCase()}: ${destructive.reason}`);
    if (destructive.affectedFiles?.length) {
      warnings.add(`Affected: ${destructive.affectedFiles.join(", ")}`);
    }
  }

  for (const { regex, description } of DANGEROUS_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(command)) {
      warnings.add(description);
    }
  }

  return [...warnings];
}

/**
 * Detect dangerous patterns in a shell command.
 * Returns an array of detected patterns (empty = safe).
 */
export function detectDangerousPatterns(command: string): DangerousPattern[] {
  const results: DangerousPattern[] = [];
  for (const { regex, description } of DANGEROUS_PATTERNS) {
    // Reset regex lastIndex for global patterns
    regex.lastIndex = 0;
    const match = regex.exec(command);
    if (match) {
      results.push({
        pattern: regex.source,
        description,
        match: match[0],
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Self-Kill Prevention
// ---------------------------------------------------------------------------

/**
 * Check if a command would kill the CLI's own process.
 */
export function isSelfKillCommand(command: string): boolean {
  const pid = process.pid;
  const patterns = [
    new RegExp(`\\bkill\\b.*\\b${pid}\\b`),
    new RegExp(`\\bkill\\s+-9\\s+${pid}\\b`),
    /\bkill\s+all\b/i,
    /\bpkill\b/,
    /\bkillall\b/,
  ];
  return patterns.some((p) => p.test(command));
}

// ---------------------------------------------------------------------------
// Persistent CWD
// ---------------------------------------------------------------------------

let bashSessionCwd: string | null = null;

export function getBashSessionCwd(): string {
  return bashSessionCwd ?? process.cwd();
}

export function setBashSessionCwd(dir: string): void {
  bashSessionCwd = dir;
}

// ---------------------------------------------------------------------------
// Shell Resolution
// ---------------------------------------------------------------------------

function getShellInfo(): { shell: string; shellFlag: string } {
  if (process.platform === "win32") {
    return { shell: "powershell.exe", shellFlag: "-Command" };
  }
  return { shell: "/bin/bash", shellFlag: "-c" };
}

// ---------------------------------------------------------------------------
// PTY-based Execution
// ---------------------------------------------------------------------------

/**
 * Execute a shell command asynchronously using child_process.spawn (non-blocking).
 * This replaces execSync while maintaining compatibility.
 * For full PTY support, node-pty can be used as an upgrade path.
 */
export async function executeBash(options: BashOptions): Promise<BashResult> {
  const {
    command,
    cwd,
    timeout = 30000,
    env = {},
    onStdout,
    onStderr,
  } = options;

  const startTime = Date.now();
  const effectiveCwd = cwd ?? bashSessionCwd ?? process.cwd();

  // Self-kill prevention
  if (isSelfKillCommand(command)) {
    return {
      stdout: "",
      stderr: "Blocked: command would kill the CLI process",
      exitCode: 1,
      cwd: effectiveCwd,
      duration: 0,
      timedOut: false,
    };
  }

  const { shell, shellFlag } = getShellInfo();

  return new Promise<BashResult>((resolve) => {
    const { spawn } = require("child_process") as typeof import("child_process");

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(shell, [shellFlag, command], {
      cwd: effectiveCwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeoutHandle = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
          // Force kill after 2s if SIGTERM doesn't work
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch { /* already dead */ }
          }, 2000);
        }, timeout)
      : null;

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      onStdout?.(chunk);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      onStderr?.(chunk);
    });

    proc.on("close", (code: number | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Truncate output to prevent token overflow
      const result: BashResult = {
        stdout: stdout.slice(0, 16384),
        stderr: stderr.slice(0, 8192),
        exitCode: code ?? (timedOut ? 124 : 0),
        cwd: effectiveCwd,
        duration,
        timedOut,
      };

      if (timedOut) {
        logger.warn(`[bash] Command timed out after ${timeout}ms: ${command.slice(0, 100)}`);
      }

      resolve(result);
    });

    proc.on("error", (err: Error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        cwd: effectiveCwd,
        duration: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// PTY-based Execution (node-pty, for interactive commands)
// ---------------------------------------------------------------------------

/**
 * Execute a command using node-pty for full PTY support.
 * Use this for interactive commands that need terminal emulation.
 */
export async function executeBashPty(options: BashOptions): Promise<BashResult> {
  const {
    command,
    cwd,
    timeout = 30000,
    env = {},
    onStdout,
    onStderr,
  } = options;

  const startTime = Date.now();
  const effectiveCwd = cwd ?? bashSessionCwd ?? process.cwd();

  // Self-kill prevention
  if (isSelfKillCommand(command)) {
    return {
      stdout: "",
      stderr: "Blocked: command would kill the CLI process",
      exitCode: 1,
      cwd: effectiveCwd,
      duration: 0,
      timedOut: false,
    };
  }

  const { shell, shellFlag } = getShellInfo();

  return new Promise<BashResult>((resolve) => {
    let ptyModule: typeof import("node-pty");
    try {
      ptyModule = require("node-pty");
    } catch {
      // Fallback to non-PTY if node-pty is not available
      logger.warn("[bash] node-pty not available, falling back to spawn");
      return resolve(executeBash(options));
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const ptyProcess = ptyModule.spawn(shell, [shellFlag, command], {
      cwd: effectiveCwd,
      env: { ...process.env, ...env } as Record<string, string>,
      cols: 120,
      rows: 30,
      useConpty: process.platform === "win32",
    });

    const timeoutHandle = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          ptyProcess.kill("SIGTERM");
        }, timeout)
      : null;

    ptyProcess.onData((data: string) => {
      stdout += data;
      onStdout?.(data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      resolve({
        stdout: stdout.slice(0, 16384),
        stderr: stderr.slice(0, 8192),
        exitCode: timedOut ? 124 : exitCode,
        cwd: effectiveCwd,
        duration,
        timedOut,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// cd handling (Copilot-style persistent cwd)
// ---------------------------------------------------------------------------

interface CdResolveResult {
  command: string;
  cwd: string;
  persistCwd?: string;
  shortCircuit?: BashResult;
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveDirectoryTarget(targetRaw: string, baseCwd: string): string {
  const target = stripOuterQuotes(targetRaw);
  if (!target || target === ".") return baseCwd;

  const homeDir = os.homedir();
  if (target === "~" && homeDir) return path.resolve(homeDir);
  if ((target.startsWith("~/") || target.startsWith("~\\")) && homeDir) {
    return path.resolve(homeDir, target.slice(2));
  }

  return path.resolve(baseCwd, target);
}

export function resolveBashInvocation(command: string, cwd?: string): CdResolveResult {
  const startingCwd = cwd
    ? path.resolve(cwd)
    : (bashSessionCwd ?? process.cwd());

  // Pure cd command
  const directChange = command.match(/^\s*(?:cd|set-location)\s+(.+?)\s*;?\s*$/i);
  if (directChange) {
    const nextCwd = resolveDirectoryTarget(directChange[1] ?? "", startingCwd);
    if (!fs.existsSync(nextCwd) || !fs.statSync(nextCwd).isDirectory()) {
      return {
        command,
        cwd: startingCwd,
        shortCircuit: {
          stdout: "",
          stderr: `Directory not found: ${nextCwd}`,
          exitCode: 1,
          cwd: startingCwd,
          duration: 0,
          timedOut: false,
        },
      };
    }
    bashSessionCwd = nextCwd;
    return {
      command,
      cwd: nextCwd,
      persistCwd: nextCwd,
      shortCircuit: {
        stdout: nextCwd,
        stderr: "",
        exitCode: 0,
        cwd: nextCwd,
        duration: 0,
        timedOut: false,
      },
    };
  }

  // cd && command
  const leadingChange = command.match(/^\s*(?:cd|set-location)\s+(.+?)\s*(?:&&|;)\s*([\s\S]+)$/i);
  if (leadingChange) {
    const nextCwd = resolveDirectoryTarget(leadingChange[1] ?? "", startingCwd);
    if (!fs.existsSync(nextCwd) || !fs.statSync(nextCwd).isDirectory()) {
      return {
        command,
        cwd: startingCwd,
        shortCircuit: {
          stdout: "",
          stderr: `Directory not found: ${nextCwd}`,
          exitCode: 1,
          cwd: startingCwd,
          duration: 0,
          timedOut: false,
        },
      };
    }
    const nextCommand = (leadingChange[2] ?? "").trim();
    if (!nextCommand) {
      bashSessionCwd = nextCwd;
      return {
        command,
        cwd: nextCwd,
        persistCwd: nextCwd,
        shortCircuit: {
          stdout: nextCwd,
          stderr: "",
          exitCode: 0,
          cwd: nextCwd,
          duration: 0,
          timedOut: false,
        },
      };
    }
    return {
      command: nextCommand,
      cwd: nextCwd,
      persistCwd: nextCwd,
    };
  }

  return { command, cwd: startingCwd };
}

// ---------------------------------------------------------------------------
// Windows path normalization
// ---------------------------------------------------------------------------

export function normalizeBashCommandForPlatform(command: string): string {
  if (process.platform !== "win32") return command;

  let normalized = command;
  normalized = normalized.replace(
    /\bmkdir\s+-p\s+((?:[^\s"]+|"[^"]+")+)/gi,
    (_match, target) => {
      const cleanTarget = target.trim().replace(/^["']|["']$/g, "");
      const escapedTarget = cleanTarget.replace(/'/g, "''");
      return `if (-not (Test-Path -LiteralPath '${escapedTarget}')) { New-Item -ItemType Directory -Force -Path '${escapedTarget}' | Out-Null }`;
    },
  );
  return normalized;
}

// Alias for backward compatibility
export const bash = executeBash;
