/**
 * PowerShell Tool - Windows Shell Support for Pakalon CLI
 * 
 * Adapted from Claude Code's PowerShellTool implementation.
 * Features:
 * - PTY-based execution with streaming output
 * - Async/background command support
 * - Configurable timeout with auto-background
 * - Read-only command detection for auto-approval
 * - Security validation (dangerous patterns, self-kill prevention)
 * - Persistent working directory across calls
 * - Windows/PowerShell-specific syntax handling
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PowerShellOptions {
  command: string;
  timeout?: number;
  description?: string;
  runInBackground?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  onOutput?: (chunk: string) => void;
}

export interface PowerShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  interrupted: boolean;
  cwd: string;
  duration: number;
  timedOut: boolean;
  backgroundTaskId?: string;
  isImage?: boolean;
  returnCodeInterpretation?: string;
}

export interface PowerShellProgress {
  status: "running" | "completed" | "failed" | "backgrounded";
  elapsedMs: number;
  outputLines: number;
  command: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_TIMEOUT_MS = 600000; // 10 minutes
const MAX_OUTPUT_LENGTH = 30000;
const PROGRESS_THRESHOLD_MS = 2000;
const ASSISTANT_BLOCKING_BUDGET_MS = 15000;

// ---------------------------------------------------------------------------
// PowerShell Command Aliases (canonical name mappings)
// ---------------------------------------------------------------------------

const PS_ALIASES: Record<string, string> = {
  // Common aliases to canonical cmdlet names
  "ls": "get-childitem",
  "dir": "get-childitem",
  "gci": "get-childitem",
  "cd": "set-location",
  "sl": "set-location",
  "chdir": "set-location",
  "cat": "get-content",
  "gc": "get-content",
  "type": "get-content",
  "pwd": "get-location",
  "gl": "get-location",
  "echo": "write-output",
  "write": "write-output",
  "rm": "remove-item",
  "ri": "remove-item",
  "del": "remove-item",
  "erase": "remove-item",
  "rd": "remove-item",
  "rmdir": "remove-item",
  "cp": "copy-item",
  "ci": "copy-item",
  "copy": "copy-item",
  "mv": "move-item",
  "mi": "move-item",
  "move": "move-item",
  "cls": "clear-host",
  "clear": "clear-host",
  "man": "get-help",
  "help": "get-help",
  "ps": "get-process",
  "gps": "get-process",
  "kill": "stop-process",
  "spps": "stop-process",
  "sleep": "start-sleep",
  "where": "where-object",
  "?": "where-object",
  "%": "foreach-object",
  "foreach": "foreach-object",
  "select": "select-object",
  "sort": "sort-object",
  "measure": "measure-object",
  "diff": "compare-object",
  "compare": "compare-object",
  "sc": "set-content",
  "ac": "add-content",
  "clc": "clear-content",
  "ni": "new-item",
  "md": "new-item",
  "mkdir": "new-item",
  "ii": "invoke-item",
  "iex": "invoke-expression",
  "icm": "invoke-command",
  "iwr": "invoke-webrequest",
  "irm": "invoke-restmethod",
  "curl": "invoke-webrequest",
  "wget": "invoke-webrequest",
};

/**
 * Resolve alias to canonical cmdlet name
 */
export function resolveToCanonical(command: string): string {
  const lower = command.toLowerCase();
  return PS_ALIASES[lower] ?? lower;
}

// ---------------------------------------------------------------------------
// Read-Only Command Detection
// ---------------------------------------------------------------------------

const READ_ONLY_CMDLETS = new Set([
  // Filesystem read
  "get-childitem",
  "get-content",
  "get-item",
  "get-itemproperty",
  "get-itempropertyvalue",
  "test-path",
  "resolve-path",
  "get-location",
  "get-psdrive",
  "get-filehash",
  "get-acl",
  "format-hex",
  // Process/Service info
  "get-process",
  "get-service",
  "get-eventlog",
  "get-winevent",
  // System info
  "get-computerinfo",
  "get-host",
  "get-culture",
  "get-date",
  "get-timezone",
  "get-random",
  "get-uptime",
  // Network info
  "get-netadapter",
  "get-netipaddress",
  "get-netroute",
  "get-dnsclient",
  "test-connection",
  "test-netconnection",
  "resolve-dnsname",
  // Module/Command info
  "get-command",
  "get-module",
  "get-alias",
  "get-help",
  "get-verb",
  // Variable/Environment
  "get-variable",
  "get-childitem env:",
  // Output formatting (no side effects)
  "format-list",
  "format-table",
  "format-wide",
  "format-custom",
  "out-string",
  "convertto-json",
  "convertto-csv",
  "convertto-xml",
  "convertto-html",
  "convertfrom-json",
  "convertfrom-csv",
  // Selection/Filtering
  "select-object",
  "where-object",
  "sort-object",
  "group-object",
  "measure-object",
  "compare-object",
  "foreach-object",
  // String operations
  "select-string",
  "join-string",
  "split-path",
  "join-path",
  // Misc read-only
  "write-output",
  "write-host",
  "write-verbose",
  "write-debug",
  "write-information",
  "write-warning",
  "out-null",
  "out-host",
  "out-default",
]);

const READ_ONLY_EXTERNAL: Record<string, { safeFlags?: string[]; safeSubcommands?: string[] }> = {
  "git": {
    safeSubcommands: [
      "status", "log", "diff", "branch", "show", "blame", "remote", "tag",
      "stash list", "reflog", "describe", "rev-parse", "config", "ls-files",
      "ls-tree", "cat-file", "rev-list", "shortlog", "log", "whatchanged",
    ],
  },
  "npm": {
    safeSubcommands: ["list", "ls", "view", "info", "show", "search", "outdated", "config list"],
  },
  "yarn": {
    safeSubcommands: ["list", "info", "why", "outdated", "config list"],
  },
  "pnpm": {
    safeSubcommands: ["list", "ls", "view", "info", "outdated", "why"],
  },
  "docker": {
    safeSubcommands: [
      "ps", "images", "image ls", "container ls", "volume ls", "network ls",
      "inspect", "logs", "stats", "top", "diff", "history", "version", "info",
    ],
  },
  "kubectl": {
    safeSubcommands: [
      "get", "describe", "logs", "top", "cluster-info", "config view",
      "version", "api-resources", "api-versions", "explain",
    ],
  },
  "az": {
    safeSubcommands: ["account show", "account list", "group list", "version", "configure --list-defaults"],
  },
  "dotnet": {
    safeFlags: ["--version", "--info", "--list-runtimes", "--list-sdks"],
  },
  "node": {
    safeFlags: ["--version", "-v", "-e", "--eval", "-p", "--print"],
  },
  "python": {
    safeFlags: ["--version", "-V", "-c"],
  },
  "python3": {
    safeFlags: ["--version", "-V", "-c"],
  },
  "go": {
    safeSubcommands: ["version", "env", "list", "doc"],
  },
  "cargo": {
    safeSubcommands: ["--version", "version", "search", "tree"],
  },
  "rustc": {
    safeFlags: ["--version", "-V", "--print"],
  },
  "java": {
    safeFlags: ["--version", "-version"],
  },
  "javac": {
    safeFlags: ["--version", "-version"],
  },
  "terraform": {
    safeSubcommands: ["version", "show", "state list", "state show", "output", "providers", "validate"],
  },
  "helm": {
    safeSubcommands: ["version", "list", "ls", "show", "status", "get", "history", "search"],
  },
  "gh": {
    safeSubcommands: [
      "auth status", "repo view", "issue list", "issue view", "pr list", "pr view",
      "pr status", "pr diff", "pr checks", "release list", "release view",
      "workflow list", "run list", "run view", "config list", "api",
    ],
  },
};

/**
 * Check if command is read-only (safe to auto-approve)
 */
export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Split on pipeline and statement separators
  const parts = trimmed.split(/\s*[;|]\s*/).filter(Boolean);
  
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const firstToken = tokens[0];
    if (!firstToken) continue;

    const canonical = resolveToCanonical(firstToken);

    // Check PowerShell cmdlets
    if (READ_ONLY_CMDLETS.has(canonical)) {
      continue;
    }

    // Check external commands
    const extConfig = READ_ONLY_EXTERNAL[canonical] || READ_ONLY_EXTERNAL[firstToken.toLowerCase()];
    if (extConfig) {
      const restOfCommand = tokens.slice(1).join(" ");
      
      // Check safe flags
      if (extConfig.safeFlags) {
        const hasOnlySafeFlags = tokens.slice(1).every(
          t => extConfig.safeFlags!.includes(t) || !t.startsWith("-")
        );
        if (hasOnlySafeFlags) continue;
      }

      // Check safe subcommands
      if (extConfig.safeSubcommands) {
        const matchesSafe = extConfig.safeSubcommands.some(
          sub => restOfCommand.startsWith(sub) || restOfCommand === sub
        );
        if (matchesSafe) continue;
      }

      return false;
    }

    // Unknown command - not read-only
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Security Validation
// ---------------------------------------------------------------------------

export interface DangerousPattern {
  pattern: string;
  description: string;
  match: string;
}

const DANGEROUS_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /\$\([^)]*\)/g, description: "Subexpression $(...)" },
  { regex: /`[^`]+`/g, description: "Backtick substitution (in double quotes)" },
  { regex: /\$\{[^}]+\}/g, description: "Variable expansion ${VAR}" },
  { regex: /Invoke-Expression/gi, description: "Invoke-Expression (code injection risk)" },
  { regex: /iex\s+/gi, description: "iex alias (code injection risk)" },
  { regex: /\[System\.Reflection/gi, description: "Reflection API access" },
  { regex: /\[System\.Runtime\.InteropServices/gi, description: "P/Invoke access" },
  { regex: /Add-Type.*-TypeDefinition/gi, description: "Dynamic type compilation" },
  { regex: /Start-Process.*-Credential/gi, description: "Credential escalation" },
  { regex: /\bNew-Object\s+.*Net\.WebClient/gi, description: "WebClient download" },
  { regex: /\bDownloadString\b/gi, description: "Remote code download" },
  { regex: /\bDownloadFile\b/gi, description: "Remote file download" },
  { regex: /Set-ExecutionPolicy/gi, description: "Execution policy change" },
  { regex: /\bRemove-Item\s+.*-Recurse.*-Force/gi, description: "Recursive force delete" },
  { regex: /\bFormat-Volume\b/gi, description: "Volume formatting" },
  { regex: /\bClear-Disk\b/gi, description: "Disk wiping" },
  { regex: /\\\\[a-zA-Z0-9._-]+\\[a-zA-Z]/g, description: "UNC path access" },
  { regex: /HKLM:\\|HKCU:\\/gi, description: "Registry modification" },
];

/**
 * Detect dangerous patterns in PowerShell command
 */
export function detectDangerousPatterns(command: string): DangerousPattern[] {
  const results: DangerousPattern[] = [];
  for (const { regex, description } of DANGEROUS_PATTERNS) {
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

/**
 * Check for security concerns that should prevent auto-approval
 */
export function hasSyncSecurityConcerns(command: string): boolean {
  // Variable expansion in arguments
  if (/\$[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/.test(command)) {
    // Allow $env: reads and $null
    if (!/\$(?:env:|null|true|false|_|\d+)\b/i.test(command)) {
      return true;
    }
  }

  // Subexpressions
  if (/\$\([^)]*\)/.test(command)) {
    return true;
  }

  // Script blocks in arguments
  if (/\{\s*[^}]*\}/.test(command) && !/Where-Object|ForEach-Object|%|[?]/.test(command)) {
    return true;
  }

  // Splatting
  if (/@[a-zA-Z_][a-zA-Z0-9_]*/.test(command)) {
    return true;
  }

  // Member invocation
  if (/\.\s*\w+\s*\(/.test(command)) {
    return true;
  }

  return false;
}

/**
 * Check if command would kill the CLI process
 */
export function isSelfKillCommand(command: string): boolean {
  const pid = process.pid;
  const patterns = [
    new RegExp(`\\bStop-Process\\b.*\\b${pid}\\b`, "i"),
    new RegExp(`\\bStop-Process\\s+-Id\\s+${pid}\\b`, "i"),
    new RegExp(`\\bkill\\b.*\\b${pid}\\b`),
    /\bStop-Process\s+.*-Name\s+node\b/i,
    /\btaskkill\s+.*node/i,
  ];
  return patterns.some(p => p.test(command));
}

/**
 * Detect blocked sleep patterns
 */
export function detectBlockedSleepPattern(command: string): string | null {
  const first = command.trim().split(/[;|&\r\n]/)[0]?.trim() ?? "";
  const match = /^(?:start-sleep|sleep)(?:\s+-(?:s(?:econds)?|m(?:illiseconds)?)?)?\s+(\d+)\s*$/i.exec(first);
  
  if (!match) return null;
  
  const value = parseInt(match[1]!, 10);
  // Check if it's milliseconds (short sleep ok) or seconds (block if >= 2s)
  const isMilliseconds = /-m(?:illiseconds)?/i.test(first);
  
  if (isMilliseconds && value < 2000) return null;
  if (!isMilliseconds && value < 2) return null;

  const rest = command.trim().slice(first.length).replace(/^[\s;|&]+/, "");
  return rest ? `Start-Sleep ${value} followed by: ${rest}` : `standalone Start-Sleep ${value}`;
}

// ---------------------------------------------------------------------------
// Persistent CWD
// ---------------------------------------------------------------------------

let psSessionCwd: string | null = null;

export function getPsSessionCwd(): string {
  return psSessionCwd ?? process.cwd();
}

export function setPsSessionCwd(dir: string): void {
  psSessionCwd = dir;
}

// ---------------------------------------------------------------------------
// PowerShell Path Resolution
// ---------------------------------------------------------------------------

let cachedPsPath: string | null = null;

/**
 * Get PowerShell executable path
 */
export function getPowerShellPath(): string {
  if (cachedPsPath) return cachedPsPath;

  // Prefer pwsh (PowerShell Core) if available
  const pwshPaths = [
    "pwsh",
    "pwsh.exe",
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe",
  ];

  for (const psPath of pwshPaths) {
    try {
      const { execSync } = require("child_process") as typeof import("child_process");
      execSync(`"${psPath}" -NoProfile -Command "$PSVersionTable"`, { stdio: "ignore" });
      cachedPsPath = psPath;
      return psPath;
    } catch {
      // Not found, try next
    }
  }

  // Fall back to Windows PowerShell
  cachedPsPath = "powershell.exe";
  return cachedPsPath;
}

/**
 * Detect PowerShell edition (Core vs Desktop)
 */
export type PowerShellEdition = "core" | "desktop" | "unknown";

let cachedEdition: PowerShellEdition | null = null;

export async function getPowerShellEdition(): Promise<PowerShellEdition> {
  if (cachedEdition) return cachedEdition;

  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    const psPath = getPowerShellPath();
    const output = execSync(
      `"${psPath}" -NoProfile -Command "$PSVersionTable.PSEdition"`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();

    if (output.toLowerCase() === "core") {
      cachedEdition = "core";
    } else if (output.toLowerCase() === "desktop") {
      cachedEdition = "desktop";
    } else {
      cachedEdition = "unknown";
    }
  } catch {
    cachedEdition = "unknown";
  }

  return cachedEdition;
}

// ---------------------------------------------------------------------------
// cd Handling (persistent cwd)
// ---------------------------------------------------------------------------

interface CdResolveResult {
  command: string;
  cwd: string;
  persistCwd?: string;
  shortCircuit?: PowerShellResult;
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

  // Handle $env:USERPROFILE, $HOME, etc.
  if (target.startsWith("$env:")) {
    const varName = target.slice(5);
    const varValue = process.env[varName];
    if (varValue) return path.resolve(varValue);
  }

  return path.resolve(baseCwd, target);
}

export function resolvePsInvocation(command: string, cwd?: string): CdResolveResult {
  const startingCwd = cwd ? path.resolve(cwd) : (psSessionCwd ?? process.cwd());

  // Pure cd/Set-Location command
  const directChange = command.match(/^\s*(?:cd|set-location|sl)\s+(.+?)\s*;?\s*$/i);
  if (directChange) {
    const nextCwd = resolveDirectoryTarget(directChange[1] ?? "", startingCwd);
    if (!fs.existsSync(nextCwd) || !fs.statSync(nextCwd).isDirectory()) {
      return {
        command,
        cwd: startingCwd,
        shortCircuit: {
          stdout: "",
          stderr: `Set-Location : Cannot find path '${nextCwd}' because it does not exist.`,
          exitCode: 1,
          interrupted: false,
          cwd: startingCwd,
          duration: 0,
          timedOut: false,
        },
      };
    }
    psSessionCwd = nextCwd;
    return {
      command,
      cwd: nextCwd,
      persistCwd: nextCwd,
      shortCircuit: {
        stdout: `Path\n----\n${nextCwd}`,
        stderr: "",
        exitCode: 0,
        interrupted: false,
        cwd: nextCwd,
        duration: 0,
        timedOut: false,
      },
    };
  }

  // cd && command or cd; command
  const leadingChange = command.match(/^\s*(?:cd|set-location|sl)\s+(.+?)\s*(?:&&|;)\s*([\s\S]+)$/i);
  if (leadingChange) {
    const nextCwd = resolveDirectoryTarget(leadingChange[1] ?? "", startingCwd);
    if (!fs.existsSync(nextCwd) || !fs.statSync(nextCwd).isDirectory()) {
      return {
        command,
        cwd: startingCwd,
        shortCircuit: {
          stdout: "",
          stderr: `Set-Location : Cannot find path '${nextCwd}' because it does not exist.`,
          exitCode: 1,
          interrupted: false,
          cwd: startingCwd,
          duration: 0,
          timedOut: false,
        },
      };
    }
    const nextCommand = (leadingChange[2] ?? "").trim();
    if (!nextCommand) {
      psSessionCwd = nextCwd;
      return {
        command,
        cwd: nextCwd,
        persistCwd: nextCwd,
        shortCircuit: {
          stdout: `Path\n----\n${nextCwd}`,
          stderr: "",
          exitCode: 0,
          interrupted: false,
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
// PowerShell Execution
// ---------------------------------------------------------------------------

/**
 * Execute a PowerShell command
 */
export async function executePowerShell(options: PowerShellOptions): Promise<PowerShellResult> {
  const {
    command,
    timeout = DEFAULT_TIMEOUT_MS,
    description,
    runInBackground = false,
    cwd,
    env = {},
    onOutput,
  } = options;

  const startTime = Date.now();
  
  // Resolve cd commands and get effective cwd
  const resolved = resolvePsInvocation(command, cwd);
  if (resolved.shortCircuit) {
    return resolved.shortCircuit;
  }

  const effectiveCwd = resolved.cwd;
  const effectiveCommand = resolved.command;

  // Self-kill prevention
  if (isSelfKillCommand(effectiveCommand)) {
    return {
      stdout: "",
      stderr: "Blocked: command would kill the CLI process",
      exitCode: 1,
      interrupted: false,
      cwd: effectiveCwd,
      duration: 0,
      timedOut: false,
    };
  }

  const psPath = getPowerShellPath();

  return new Promise<PowerShellResult>((resolve) => {
    const { spawn } = require("child_process") as typeof import("child_process");

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;

    // Build PowerShell arguments
    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      effectiveCommand,
    ];

    const proc = spawn(psPath, psArgs, {
      cwd: effectiveCwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const effectiveTimeout = Math.min(timeout, MAX_TIMEOUT_MS);
    const timeoutHandle = effectiveTimeout > 0
      ? setTimeout(() => {
          timedOut = true;
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch { /* ignore */ }
          }, 2000);
        }, effectiveTimeout)
      : null;

    proc.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      onOutput?.(chunk);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      onOutput?.(chunk);
    });

    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      // Update persistent cwd if needed
      if (resolved.persistCwd) {
        psSessionCwd = resolved.persistCwd;
      }

      // Check if interrupted by signal
      interrupted = signal !== null;

      // Truncate output
      const result: PowerShellResult = {
        stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
        stderr: stderr.slice(0, MAX_OUTPUT_LENGTH / 2),
        exitCode: code ?? (timedOut ? 124 : (signal ? 128 : 0)),
        interrupted,
        cwd: effectiveCwd,
        duration,
        timedOut,
      };

      if (timedOut) {
        logger.warn(`[powershell] Command timed out after ${effectiveTimeout}ms: ${effectiveCommand.slice(0, 100)}`);
      }

      resolve(result);
    });

    proc.on("error", (err: Error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        interrupted: false,
        cwd: effectiveCwd,
        duration: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// PTY-based Execution (for interactive commands)
// ---------------------------------------------------------------------------

/**
 * Execute PowerShell with PTY support
 */
export async function executePowerShellPty(options: PowerShellOptions): Promise<PowerShellResult> {
  const {
    command,
    timeout = DEFAULT_TIMEOUT_MS,
    cwd,
    env = {},
    onOutput,
  } = options;

  const startTime = Date.now();
  
  const resolved = resolvePsInvocation(command, cwd);
  if (resolved.shortCircuit) {
    return resolved.shortCircuit;
  }

  const effectiveCwd = resolved.cwd;
  const effectiveCommand = resolved.command;

  if (isSelfKillCommand(effectiveCommand)) {
    return {
      stdout: "",
      stderr: "Blocked: command would kill the CLI process",
      exitCode: 1,
      interrupted: false,
      cwd: effectiveCwd,
      duration: 0,
      timedOut: false,
    };
  }

  const psPath = getPowerShellPath();

  return new Promise<PowerShellResult>((resolve) => {
    let ptyModule: typeof import("node-pty");
    try {
      ptyModule = require("node-pty");
    } catch {
      logger.warn("[powershell] node-pty not available, falling back to spawn");
      return resolve(executePowerShell(options));
    }

    let stdout = "";
    let timedOut = false;
    let interrupted = false;

    const psArgs = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command",
      effectiveCommand,
    ];

    const ptyProcess = ptyModule.spawn(psPath, psArgs, {
      cwd: effectiveCwd,
      env: { ...process.env, ...env } as Record<string, string>,
      cols: 120,
      rows: 30,
      useConpty: true, // Use ConPTY on Windows
    });

    const effectiveTimeout = Math.min(timeout, MAX_TIMEOUT_MS);
    const timeoutHandle = effectiveTimeout > 0
      ? setTimeout(() => {
          timedOut = true;
          ptyProcess.kill("SIGTERM");
        }, effectiveTimeout)
      : null;

    ptyProcess.onData((data: string) => {
      stdout += data;
      onOutput?.(data);
    });

    ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      if (resolved.persistCwd) {
        psSessionCwd = resolved.persistCwd;
      }

      interrupted = signal !== undefined && signal !== 0;

      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT_LENGTH),
        stderr: "",
        exitCode: timedOut ? 124 : exitCode,
        interrupted,
        cwd: effectiveCwd,
        duration,
        timedOut,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tool Schema & Definition
// ---------------------------------------------------------------------------

export const powerShellToolSchema = z.object({
  command: z.string().describe("The PowerShell command to execute"),
  timeout: z.number().optional().describe(`Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS})`),
  description: z.string().optional().describe("Clear, concise description of what this command does"),
  run_in_background: z.boolean().optional().describe("Run in background and notify on completion"),
});

export type PowerShellToolInput = z.infer<typeof powerShellToolSchema>;

export const powerShellToolDefinition = {
  name: "powershell",
  description: "Execute PowerShell commands on Windows with PTY support, streaming, and timeout handling",
  inputSchema: powerShellToolSchema,
  isReadOnly: (input: PowerShellToolInput): boolean => {
    if (hasSyncSecurityConcerns(input.command)) return false;
    return isReadOnlyCommand(input.command);
  },
  async execute(input: PowerShellToolInput): Promise<PowerShellResult> {
    // Validate input
    const sleepPattern = detectBlockedSleepPattern(input.command);
    if (sleepPattern && !input.run_in_background) {
      return {
        stdout: "",
        stderr: `Blocked: ${sleepPattern}. Use run_in_background: true for long-running commands.`,
        exitCode: 1,
        interrupted: false,
        cwd: getPsSessionCwd(),
        duration: 0,
        timedOut: false,
      };
    }

    return executePowerShell({
      command: input.command,
      timeout: input.timeout,
      description: input.description,
      runInBackground: input.run_in_background,
    });
  },
};

// ---------------------------------------------------------------------------
// Tool Prompt
// ---------------------------------------------------------------------------

export async function getPowerShellPrompt(): Promise<string> {
  const edition = await getPowerShellEdition();
  
  const editionSection = edition === "core"
    ? `PowerShell Edition: PowerShell 7+ (pwsh)
   - Pipeline chain operators \`&&\` and \`||\` ARE available
   - Ternary, null-coalescing, and null-conditional operators available
   - Default encoding: UTF-8 without BOM`
    : edition === "desktop"
    ? `PowerShell Edition: Windows PowerShell 5.1
   - Pipeline chain operators \`&&\` and \`||\` are NOT available
   - Use \`A; if ($?) { B }\` for conditional chaining
   - Default encoding: UTF-16 LE with BOM`
    : `PowerShell Edition: Unknown (assume 5.1 compatibility)
   - Avoid \`&&\`, \`||\`, ternary, null-coalescing operators`;

  return `Execute PowerShell commands with PTY support and streaming output.

${editionSection}

Usage Notes:
- Working directory persists between commands
- Timeout: ${DEFAULT_TIMEOUT_MS / 1000}s default, ${MAX_TIMEOUT_MS / 1000}s max
- Output truncated to ${MAX_OUTPUT_LENGTH} characters
- Use run_in_background for long-running commands

PowerShell Syntax:
- Variables: $myVar = "value"
- Escape character: backtick (\`)
- Cmdlets: Verb-Noun naming (Get-ChildItem, Set-Location)
- Common aliases: ls, cd, cat, pwd, rm, cp, mv
- String interpolation: "Hello $name" or "Hello $($obj.Property)"
- Registry: HKLM:\\, HKCU:\\ (NOT HKEY_LOCAL_MACHINE)
- Environment: $env:NAME

Interactive Commands (blocked in -NonInteractive):
- Read-Host, Get-Credential, Out-GridView, pause
- Use -Confirm:$false for destructive cmdlets

Multiline strings (for git commit, etc.):
git commit -m @'
Commit message here
'@

Prefer dedicated tools over PowerShell:
- File search: Use Glob/Grep tools
- File read/edit: Use FileRead/FileEdit tools
- File write: Use FileWrite tool`;
}

export default {
  executePowerShell,
  executePowerShellPty,
  isReadOnlyCommand,
  detectDangerousPatterns,
  hasSyncSecurityConcerns,
  isSelfKillCommand,
  detectBlockedSleepPattern,
  getPsSessionCwd,
  setPsSessionCwd,
  getPowerShellPath,
  getPowerShellEdition,
  getPowerShellPrompt,
  powerShellToolDefinition,
  powerShellToolSchema,
};
