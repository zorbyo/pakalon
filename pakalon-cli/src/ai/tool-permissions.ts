/**
 * Tool Permission Manager — Copilot CLI parity.
 *
 * Supports fine-grained tool permissions matching Copilot CLI's:
 *   --allow-all-tools           Bypass all prompts (dangerous)
 *   --allow-tool='shell(git)'   Allow specific tool (optionally with command pattern)
 *   --deny-tool='shell(rm)'     Block specific tool/command
 *
 * Pattern formats:
 *   "bash"              → allow/deny the bash tool entirely
 *   "bash(git)"         → allow/deny bash commands matching "git"
 *   "bash(git commit)"  → allow/deny bash commands matching "git commit"
 *   "writeFile"         → allow/deny the writeFile tool
 *
 * Integration with the permission gate:
 *   1. CLI flags parse patterns at startup
 *   2. Before permission gate prompts, check allow/deny lists
 *   3. Matching tools are auto-approved or auto-denied
 */
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolPermissionRule {
  /** Tool name (e.g., "bash", "writeFile", "rg") */
  tool: string;
  /** Optional command pattern (e.g., "git", "ls -la") */
  commandPattern?: string;
  /** Compiled regex for the command pattern */
  commandRegex?: RegExp;
  /** The permission action */
  action: "allow" | "deny";
}

export type PermissionMode = "interactive" | "autonomous" | "yolo";

export interface PermissionGateOptions {
  allowedTools?: string[];
  deniedTools?: string[];
  allowAll?: boolean;
  mode?: PermissionMode;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let rules: ToolPermissionRule[] = [];
let allowAllTools = false;

export class PermissionGate {
  private allowedTools: Set<string>;
  private deniedTools: Set<string>;
  private allowAll: boolean;
  private mode: PermissionMode;

  constructor(options: PermissionGateOptions = {}) {
    this.allowedTools = new Set(options.allowedTools ?? []);
    this.deniedTools = new Set(options.deniedTools ?? []);
    this.allowAll = options.allowAll ?? false;
    this.mode = options.mode ?? "interactive";
  }

  async checkPermission(toolName: string, _input?: Record<string, unknown>): Promise<boolean> {
    if (this.allowAll || this.mode === "autonomous" || this.mode === "yolo") return true;
    if (this.deniedTools.has(toolName)) return false;
    if (this.allowedTools.size > 0) return this.allowedTools.has(toolName);
    return true;
  }

  getMode(): PermissionMode {
    return this.mode;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a tool permission pattern string.
 *
 * Formats:
 *   "bash"           → { tool: "bash" }
 *   "bash(git)"      → { tool: "bash", commandPattern: "git" }
 *   "shell(git)"     → { tool: "bash", commandPattern: "git" }  (alias)
 *   "rg(useState)"   → { tool: "rg", commandPattern: "useState" }
 */
export function parseToolPattern(pattern: string): { tool: string; commandPattern?: string; commandRegex?: RegExp } {
  const trimmed = pattern.trim();

  // Match: toolName(commandPattern)
  const match = trimmed.match(/^(\w+)\((.+)\)$/);
  if (match) {
    const toolName = match[1] ?? "";
    const cmdPattern = match[2] ?? "";

    // Normalize aliases: "shell" → "bash"
    const normalizedTool = toolName === "shell" ? "bash" : toolName;

    try {
      // Create a regex from the pattern (case-insensitive)
      const regex = new RegExp(cmdPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return { tool: normalizedTool, commandPattern: cmdPattern, commandRegex: regex };
    } catch {
      return { tool: normalizedTool, commandPattern: cmdPattern };
    }
  }

  // Simple tool name
  const normalizedTool = trimmed === "shell" ? "bash" : trimmed;
  return { tool: normalizedTool };
}

// ---------------------------------------------------------------------------
// Rule Management
// ---------------------------------------------------------------------------

export function setAllowAllTools(allow: boolean): void {
  allowAllTools = allow;
  if (allow) {
    logger.warn("[tool-permissions] --allow-all-tools is enabled. All tool permissions are bypassed.");
  }
}

export function isAllowAllTools(): boolean {
  return allowAllTools;
}

export function addAllowTool(pattern: string): void {
  const parsed = parseToolPattern(pattern);
  rules.push({
    tool: parsed.tool,
    commandPattern: parsed.commandPattern,
    commandRegex: parsed.commandRegex,
    action: "allow",
  });
  logger.debug("[tool-permissions] Added allow rule", { tool: parsed.tool, pattern: parsed.commandPattern });
}

export function addDenyTool(pattern: string): void {
  const parsed = parseToolPattern(pattern);
  rules.push({
    tool: parsed.tool,
    commandPattern: parsed.commandPattern,
    commandRegex: parsed.commandRegex,
    action: "deny",
  });
  logger.debug("[tool-permissions] Added deny rule", { tool: parsed.tool, pattern: parsed.commandPattern });
}

export function clearPermissionRules(): void {
  rules = [];
  allowAllTools = false;
}

// ---------------------------------------------------------------------------
// Permission Checking
// ---------------------------------------------------------------------------

/**
 * Check if a tool call is allowed, denied, or should fall through to the permission gate.
 *
 * @param toolName  The tool being called (e.g., "bash", "writeFile")
 * @param input     The tool input (used to match command patterns for bash)
 * @returns "allow" | "deny" | "default"
 */
export function checkToolPermission(
  toolName: string,
  input?: Record<string, unknown>,
): "allow" | "deny" | "default" {
  if (allowAllTools) return "allow";

  let hasRulesForTool = false;

  for (const rule of rules) {
    // Check if the rule matches the tool
    if (rule.tool !== toolName) continue;

    hasRulesForTool = true;

    // If the rule has a command pattern, check if it matches
    if (rule.commandPattern && toolName === "bash") {
      const command = String(input?.command ?? "");
      if (rule.commandRegex) {
        if (rule.commandRegex.test(command)) {
          return rule.action;
        }
      } else if (command.includes(rule.commandPattern)) {
        return rule.action;
      }
      // Pattern doesn't match, continue checking other rules
      continue;
    }

    // No command pattern — match the tool entirely
    return rule.action;
  }

  return "default";
}

/**
 * Get all configured rules (for display in /context or diagnostics).
 */
export function getPermissionRules(): ToolPermissionRule[] {
  return [...rules];
}

/**
 * Get a summary string of all rules (for TUI display).
 */
export function formatPermissionRules(): string {
  if (rules.length === 0 && !allowAllTools) return "No tool permission overrides configured.";

  const lines: string[] = [];

  if (allowAllTools) {
    lines.push("Warning:  All tool permissions bypassed (--allow-all-tools)");
  }

  for (const rule of rules) {
    const prefix = rule.action === "allow" ? "[OK]" : "[X]";
    const toolDisplay = rule.commandPattern
      ? `${rule.tool}(${rule.commandPattern})`
      : rule.tool;
    lines.push(`${prefix} ${rule.action}: ${toolDisplay}`);
  }

  for (const [tool, level] of perToolOverrides) {
    lines.push(`[~] granular: ${tool} → ${level}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Granular Permission Levels — per-tool overrides
// ============================================================================

export type GranularPermissionLevel = "allow" | "deny" | "readonly" | "prompt";

const perToolOverrides = new Map<string, GranularPermissionLevel>();

const READ_TOOL_PATTERNS = [
  /^read/i, /^get/i, /^list/i, /^search/i, /^find/i,
  /^look/i, /^view/i, /^show/i, /^cat/i, /^grep/i,
  /^glob/i, /^ls/i, /^stat/i, /^check/i, /^describe/i,
  /^session_list/, /^session_info/, /^session_read/,
  /^todo_write/, /^task_list/, /^task_get/, /^task_output/,
  /^mcp.*list/, /^mcp.*search/, /^file_read/, /^read_file/,
  /^send_message/,
];

export function isReadOperation(toolName: string, input?: Record<string, unknown>): boolean {
  const normalized = toolName.replace(/Tool$/i, "");
  if (READ_TOOL_PATTERNS.some((p) => p.test(normalized))) return true;
  if (input?._action === "read" || input?._action === "list" || input?._action === "get") return true;
  return false;
}

export function setToolPermission(toolName: string, level: GranularPermissionLevel): void {
  perToolOverrides.set(toolName, level);
}

export function getToolPermission(toolName: string): GranularPermissionLevel {
  return perToolOverrides.get(toolName) ?? "prompt";
}

export function clearToolPermissionOverrides(): void {
  perToolOverrides.clear();
}

export function listToolPermissionOverrides(): Array<{ tool: string; level: GranularPermissionLevel }> {
  return Array.from(perToolOverrides.entries()).map(([tool, level]) => ({ tool, level }));
}

export function checkGranularToolPermission(
  toolName: string,
  input?: Record<string, unknown>,
): { decision: "allow" | "deny" | "prompt"; reason?: string } {
  const level = perToolOverrides.get(toolName);
  if (!level) return { decision: "prompt" };

  switch (level) {
    case "allow":
      return { decision: "allow" };
    case "deny":
      return { decision: "deny", reason: `Tool "${toolName}" is denied by granular permission` };
    case "readonly":
      if (isReadOperation(toolName, input)) {
        return { decision: "allow", reason: "Read-only operation permitted by readonly granular permission" };
      }
      return { decision: "deny", reason: `Write operations on "${toolName}" blocked by readonly granular permission` };
    case "prompt":
      return { decision: "prompt" };
  }
}
