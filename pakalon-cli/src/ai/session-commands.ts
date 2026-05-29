/**
 * In-Session Command Handler — Copilot CLI parity.
 *
 * Intercepts special input patterns before they reach the AI model:
 *   /cwd <path>        → Change working directory
 *   /add-dir <path>    → Add trusted directory
 *   /context           → Show token usage breakdown
 *   @<filepath>        → Ingest file content into context
 *   !<command>         → Execute shell command directly (bypasses AI)
 *
 * These match Copilot CLI's in-session commands and context operators.
 */
import * as fs from "fs";
import * as path from "path";
import { setSessionCwd, getSessionCwd } from "@/ai/copilot-tools.js";
import { trustDirectory, isDirectoryTrusted, listTrustedDirectories } from "@/security/trust.js";
import { executeBash } from "@/tools/bash.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionCommandResult {
  handled: boolean;
  /** If handled, this is the output to display to the user */
  output?: string;
  /** If handled, this replaces the user's input to the AI */
  replacementInput?: string;
  /** If true, the command was a direct bypass and should not be sent to AI */
  skipAI?: boolean;
  /** Error message if command failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

const PATTERNS = {
  /** /cwd <path> — change working directory */
  CHANGE_DIR: /^\/cwd\s+(.+)$/,
  /** /add-dir <path> — add trusted directory */
  ADD_DIR: /^\/add-dir\s+(.+)$/,
  /** /context — show token usage */
  CONTEXT: /^\/context\s*$/,
  /** @<filepath> — inject file content */
  FILE_INJECT: /^@(\S+)$/,
  /** !<command> — direct shell bypass */
  DIRECT_SHELL: /^!(.+)$/,
} as const;

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * Handle /cwd <path>
 */
async function handleChangeDir(cwdPath: string): Promise<SessionCommandResult> {
  try {
    const target = cwdPath.trim();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE;

    let resolved: string;
    if (target === "~" && homeDir) {
      resolved = path.resolve(homeDir);
    } else if ((target.startsWith("~/") || target.startsWith("~\\")) && homeDir) {
      resolved = path.resolve(homeDir, target.slice(2));
    } else {
      resolved = path.resolve(getSessionCwd(), target);
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { handled: true, error: `Directory not found: ${resolved}` };
    }

    setSessionCwd(resolved);
    return {
      handled: true,
      output: `Working directory changed to: ${resolved}`,
    };
  } catch (err) {
    return { handled: true, error: String(err) };
  }
}

/**
 * Handle /add-dir <path>
 */
function handleAddDir(dirPath: string): SessionCommandResult {
  try {
    const resolved = path.resolve(dirPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { handled: true, error: `Directory not found: ${resolved}` };
    }

    trustDirectory(resolved);
    return {
      handled: true,
      output: `[OK] Directory trusted: ${resolved}`,
    };
  } catch (err) {
    return { handled: true, error: String(err) };
  }
}

/**
 * Handle /context
 */
function handleContext(): SessionCommandResult {
  const cwd = getSessionCwd();
  const trusted = listTrustedDirectories();
  const rules = (() => {
    try {
      const { getPermissionRules, formatPermissionRules } = require("@/ai/tool-permissions.js") as typeof import("@/ai/tool-permissions.js");
      return formatPermissionRules();
    } catch {
      return "No tool permission overrides.";
    }
  })();

  const lines = [
    "── Context Information ──────────────────────",
    `Working directory: ${cwd}`,
    `Trusted directories: ${trusted.length}`,
    "",
    "── Tool Permissions ─────────────────────────",
    rules,
    "",
    "── Session Info ─────────────────────────────",
    `Node.js: ${process.version}`,
    `Platform: ${process.platform}`,
    `PID: ${process.pid}`,
  ];

  return { handled: true, output: lines.join("\n") };
}

/**
 * Handle @<filepath> — inject file content
 */
function handleFileInject(filePath: string): SessionCommandResult {
  try {
    const absPath = path.resolve(getSessionCwd(), filePath);
    if (!fs.existsSync(absPath)) {
      return { handled: true, error: `File not found: ${absPath}` };
    }

    const content = fs.readFileSync(absPath, "utf-8");
    const relPath = path.relative(getSessionCwd(), absPath);

    // Return the file content as a replacement input to the AI
    return {
      handled: true,
      replacementInput: `Here is the content of ${relPath}:\n\n\`\`\`\n${content}\n\`\`\`\n\nPlease analyze this file.`,
      output: `Injected file content: ${relPath} (${content.length} chars)`,
    };
  } catch (err) {
    return { handled: true, error: String(err) };
  }
}

/**
 * Handle !<command> — direct shell bypass
 */
async function handleDirectShell(command: string): Promise<SessionCommandResult> {
  try {
    const result = await executeBash({
      command: command.trim(),
      cwd: getSessionCwd(),
      timeout: 30000,
    });

    const output = [
      result.stdout ? result.stdout.trimEnd() : "",
      result.stderr ? `stderr: ${result.stderr.trimEnd()}` : "",
      `exit code: ${result.exitCode}`,
    ].filter(Boolean).join("\n");

    return {
      handled: true,
      output,
      skipAI: true,
    };
  } catch (err) {
    return { handled: true, error: String(err), skipAI: true };
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Process user input for in-session commands.
 * Returns a result indicating whether the input was handled as a command.
 *
 * Usage in chat input handler:
 * ```typescript
 * const cmdResult = await handleSessionCommand(input);
 * if (cmdResult.handled) {
 *   if (cmdResult.output) displayOutput(cmdResult.output);
 *   if (cmdResult.error) displayError(cmdResult.error);
 *   if (cmdResult.skipAI) return; // Don't send to AI
 *   if (cmdResult.replacementInput) input = cmdResult.replacementInput;
 * }
 * ```
 */
export async function handleSessionCommand(input: string): Promise<SessionCommandResult> {
  const trimmed = input.trim();

  // /cwd <path>
  const cwdMatch = trimmed.match(PATTERNS.CHANGE_DIR);
  if (cwdMatch) {
    return handleChangeDir(cwdMatch[1] ?? "");
  }

  // /add-dir <path>
  const addDirMatch = trimmed.match(PATTERNS.ADD_DIR);
  if (addDirMatch) {
    return handleAddDir(addDirMatch[1] ?? "");
  }

  // /context
  const contextMatch = trimmed.match(PATTERNS.CONTEXT);
  if (contextMatch) {
    return handleContext();
  }

  // @<filepath>
  const fileMatch = trimmed.match(PATTERNS.FILE_INJECT);
  if (fileMatch) {
    return handleFileInject(fileMatch[1] ?? "");
  }

  // !<command>
  const shellMatch = trimmed.match(PATTERNS.DIRECT_SHELL);
  if (shellMatch) {
    return handleDirectShell(shellMatch[1] ?? "");
  }

  // Not a session command
  return { handled: false };
}
