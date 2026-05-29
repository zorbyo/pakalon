import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

export interface SandboxConfig {
  timeout: number;
  allowedCommands: string[];
  tempDir: string;
}

export interface SandboxExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

const SBASH_ALLOWLIST = new Set([
  "ls", "cat", "head", "tail", "echo", "pwd", "find", "grep", "sort", "wc",
  "date", "whoami", "which", "type", "git", "npm", "npx", "bun", "node",
  "python", "cargo", "go", "make",
]);

const SHELL_CONTROL_OPERATOR_PATTERN =
  /(?:^|[^\\])(?:&&|\|\||[;|<>`])|(?:^|[^\\])[$]\(|(?:^|[^\\])[$]\{|[\r\n]/;

function stripCommandQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleCommandName(command: string): string {
  const firstToken = stripCommandQuotes(command.trim().split(/\s+/)[0] ?? "");
  if (!firstToken) return "";
  return path.basename(firstToken).replace(/\.(?:exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

function getDefaultSandboxConfig(): SandboxConfig {
  return {
    timeout: 30000,
    allowedCommands: [...SBASH_ALLOWLIST],
    tempDir: path.join(os.tmpdir(), "pakalon-sandbox"),
  };
}

export async function createSandboxEnvironment(): Promise<string> {
  const sandboxDir = path.join(getDefaultSandboxConfig().tempDir, randomUUID());
  await fs.promises.mkdir(sandboxDir, { recursive: true });
  return sandboxDir;
}

export async function executeInSandbox(command: string, sandboxDir: string): Promise<SandboxExecutionResult> {
  const startTime = Date.now();
  const { spawn } = await import("child_process");
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const shellFlag = process.platform === "win32" ? "-Command" : "-c";

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn(shell, [shellFlag, command], {
      cwd: sandboxDir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 2000);
    }, getDefaultSandboxConfig().timeout);

    proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeoutHandle);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: stdout.slice(0, 16384),
        stderr: stderr.slice(0, 8192),
        duration: Date.now() - startTime,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutHandle);
      resolve({ exitCode: 1, stdout: "", stderr: err.message, duration: Date.now() - startTime });
    });
  });
}

export function validateSafeCommand(command: string): { valid: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { valid: false, reason: "Empty command" };

  if (SHELL_CONTROL_OPERATOR_PATTERN.test(trimmed)) {
    return {
      valid: false,
      reason: "Shell control operators, redirects, command substitution, and multi-line commands are not allowed",
    };
  }

  const firstToken = parseSimpleCommandName(trimmed);
  if (!firstToken) return { valid: false, reason: "Could not parse command" };

  if (!SBASH_ALLOWLIST.has(firstToken)) {
    return { valid: false, reason: `Command not in allowlist: ${firstToken}` };
  }

  return { valid: true };
}

export function getShellHistory(): string[] {
  const homeDir = os.homedir();
  const historyFiles = [
    path.join(homeDir, ".bash_history"),
    path.join(homeDir, ".zsh_history"),
    path.join(homeDir, ".history"),
  ];

  const entries: string[] = [];
  for (const file of historyFiles) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.startsWith(":")) {
            const colonIdx = line.indexOf(";");
            if (colonIdx !== -1) {
              entries.push(line.slice(colonIdx + 1).trim());
            }
          } else {
            entries.push(line.trim());
          }
        }
      }
    } catch {
      continue;
    }
  }
  return entries;
}

export function detectNoHup(command: string): boolean {
  return /\bnohup\s/.test(command.trim());
}

export function autoBackground(command: string): string {
  const trimmed = command.trim();
  if (detectNoHup(trimmed)) return trimmed;
  return `nohup ${trimmed} > /dev/null 2>&1 &`;
}

export function hasHeredoc(command: string): boolean {
  return /<<\s*(\w+)\s*$/.test(command.trim());
}

export function extractHeredocContent(command: string): string | null {
  const match = command.match(/<<\s*(\w+)\s*\n?([\s\S]*?)\n?\1\s*$/);
  if (!match) return null;
  return match[2]?.trim() ?? null;
}

export function loadAliases(): Map<string, string> {
  const aliases = new Map<string, string>();
  const homeDir = os.homedir();
  const files = [
    path.join(homeDir, ".bashrc"),
    path.join(homeDir, ".bash_aliases"),
  ];

  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf8");
        for (const line of content.split("\n")) {
          const aliasMatch = line.match(/^\s*alias\s+(\w+)=['"]?(.+?)['"]?\s*$/);
          if (aliasMatch) {
            aliases.set(aliasMatch[1]!, aliasMatch[2]!);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return aliases;
}

export function expandAliases(command: string): string {
  const aliases = loadAliases();
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0) return command;

  const firstToken = tokens[0]!;
  const expansion = aliases.get(firstToken);
  if (expansion) {
    return expansion + (tokens.length > 1 ? " " + tokens.slice(1).join(" ") : "");
  }

  return command;
}

export function detectPowerShell(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return (
    trimmed.startsWith("powershell") ||
    trimmed.startsWith("pwsh") ||
    /\bpowershell\b|\bpwsh\b/.test(trimmed)
  );
}

const VALID_POWER_SHELL_CMDLETS = new Set([
  "get-childitem", "set-location", "get-content", "write-output", "remove-item",
  "copy-item", "move-item", "new-item", "get-process", "stop-process",
  "get-service", "get-help", "get-alias", "get-command", "get-module",
  "get-variable", "get-item", "get-itemproperty", "invoke-expression",
  "invoke-webrequest", "invoke-restmethod", "select-object", "where-object",
  "foreach-object", "sort-object", "group-object", "measure-object",
  "compare-object", "format-table", "format-list", "format-wide",
  "convertto-json", "convertfrom-json", "convertto-csv", "convertfrom-csv",
  "test-path", "resolve-path", "get-location", "get-date", "get-random",
  "clear-host", "start-sleep", "start-process",
]);

const VALID_POWER_SHELL_ALIASES = new Set([
  "ls", "dir", "cd", "cat", "echo", "rm", "cp", "mv", "mkdir", "pwd",
  "cls", "clear", "ps", "kill", "sleep", "man", "help", "type", "del",
  "move", "copy", "ni", "ri", "gci", "gl", "sl", "gc", "sc", "ac",
  "curl", "wget", "iwr", "irm", "iex", "icm", "where", "select", "sort",
  "diff", "compare", "foreach", "%", "?", "gps", "spps",
]);

export function validatePowerShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const parts = trimmed.split(/\s*[;|]\s*/).filter(Boolean);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const first = tokens[0]?.toLowerCase() ?? "";
    if (!first) return false;
    if (first.includes("\\")) continue;
    if (first.startsWith("$")) continue;
    if (!VALID_POWER_SHELL_CMDLETS.has(first) && !VALID_POWER_SHELL_ALIASES.has(first)) {
      return false;
    }
  }
  return true;
}

export function normalizeWindowsPath(command: string): string {
  let normalized = command;

  normalized = normalized.replace(/\\(?!["'`\n\r0-9bfnrtu])/g, "/");

  normalized = normalized.replace(/\b([A-Za-z]):\//g, (_match, drive) => {
    return `/${drive.toLowerCase()}/`;
  });

  normalized = normalized.replace(/"([^"]+)"/g, (_match, p) => {
    return `"${p.replace(/\//g, "/")}"`;
  });

  return normalized;
}

export function detectWindowsPath(pathStr: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(pathStr) || /^\\\\/.test(pathStr);
}
