import fs from "fs";
import path from "path";
import os from "os";
import type { ToolDefinition, PermissionState } from "./executor.js";
import type { ToolPermissionContext, ToolPermissionRulesBySource, PermissionMode } from "./tool-types.js";
import { z } from "zod";
import logger from "@/utils/logger.js";
import { permissionGate } from "@/ai/permission-gate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PermissionEntry {
  state: PermissionState;
  expiresAt?: string;
  tool?: string;
}

interface PermissionConfig {
  version: number;
  defaults: Record<string, PermissionState>;
  toolOverrides: Record<string, PermissionState>;
}

export type CommandRisk = "low" | "medium" | "high" | "critical";

export interface CommandClassification {
  risk: CommandRisk;
  reason: string;
  dangerousPatterns: string[];
  confidence: "high" | "medium" | "low";
}

export interface DenialTrackingState {
  consecutiveDenials: number;
  totalDenials: number;
  lastDeniedAt: number | null;
  lastDeniedTool: string | null;
  fallbackTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PermissionConfig = {
  version: 1,
  defaults: {
    file: "allow",
    shell: "ask",
    mcp: "ask",
    python: "ask",
  },
  toolOverrides: {},
};

const PERMISSION_CONFIG_PATH = path.join(os.homedir(), ".config", "pakalon", "permissions.json");
const SESSION_TIMEOUT_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Dangerous Command Patterns
// ---------------------------------------------------------------------------

const CROSS_PLATFORM_CODE_EXEC: readonly string[] = [
  "python", "python3", "python2", "node", "deno", "tsx",
  "ruby", "perl", "php", "lua",
  "npx", "bunx", "npm run", "yarn run", "pnpm run", "bun run",
  "bash", "sh", "ssh",
];

const DESTRUCTIVE_FILE_PATTERNS: ReadonlyArray<{ pattern: RegExp; risk: CommandRisk; reason: string }> = [
  // Destructive system operations
  { pattern: /rm\s+-rf\s+\//, risk: "critical", reason: "Recursive force-delete of root filesystem" },
  { pattern: /rm\s+-rf\s+--no-preserve-root/, risk: "critical", reason: "Force-delete bypassing root preservation" },
  { pattern: /dd\s+if=.*\s+of=\//, risk: "critical", reason: "Direct disk write to root device" },
  { pattern: /mkfs\s+/, risk: "critical", reason: "Filesystem formatting operation" },
  { pattern: /fdisk\s+/, risk: "critical", reason: "Disk partition manipulation" },
  { pattern: /format\s+\w:\/\s*\/?(q|quick|fs)/i, risk: "critical", reason: "Windows drive formatting" },
  { pattern: /chmod\s+777\s+/, risk: "high", reason: "Overly permissive file permissions (777)" },
  { pattern: /chmod\s+-R\s+777\s+/, risk: "high", reason: "Recursive overly permissive permissions" },
  { pattern: /chown\s+/, risk: "high", reason: "File ownership change (may break system)" },
  // Privilege escalation
  { pattern: /sudo\s+/, risk: "high", reason: "Running command with superuser privileges" },
  { pattern: /su\s+/, risk: "high", reason: "Switch user operation" },
  { pattern: /doas\s+/, risk: "high", reason: "Alternative privilege escalation" },
  // Remote code execution / download-and-execute
  { pattern: /curl\s+.*\s*\|\s*(bash|sh)/, risk: "critical", reason: "Download and pipe to shell (remote code execution)" },
  { pattern: /wget\s+.*\s*\|\s*(bash|sh)/, risk: "critical", reason: "Download and pipe to shell (remote code execution)" },
  { pattern: /curl\s+.*-o\s+\S+\s+&&\s+(bash|sh|chmod|\.\/)/, risk: "high", reason: "Download then execute pattern" },
  // Network exfiltration
  { pattern: /(curl|wget)\s+.*(--data|-d|-X\s+POST)/, risk: "medium", reason: "Network data transfer (potential exfiltration)" },
  // Docker escapes
  { pattern: /docker\s+run\s+.*--privileged/, risk: "critical", reason: "Docker privileged mode (container escape risk)" },
  { pattern: /docker\s+run\s+.*-v\s+\/:/, risk: "high", reason: "Docker host filesystem mount" },
  // Git destructive operations
  { pattern: /git\s+push\s+.*--force/, risk: "medium", reason: "Force push overwrites remote history" },
  { pattern: /git\s+reset\s+--hard/, risk: "medium", reason: "Hard reset discards uncommitted changes" },
  // Package manager changes
  { pattern: /npm\s+(uninstall|remove|rm)\s+/, risk: "low", reason: "Package removal" },
  { pattern: /(npm|pip|gem)\s+(install|add)\s+-g\s+/, risk: "medium", reason: "Global package installation" },
  // Process termination
  { pattern: /kill\s+-9\s+/, risk: "medium", reason: "Force kill signal (SIGKILL)" },
  // File overwrites
  { pattern: /(>|1>)\s*\/(etc|dev|proc|sys)\//, risk: "critical", reason: "Direct write to system device or config" },
];

// Safe tools that can auto-allow in YOLO mode (read-only / metadata operations)
const SAFE_YOLO_TOOLS = new Set([
  "read_file", "file_read", "readFile", "ReadFileTool",
  "grep", "GrepTool",
  "glob", "GlobTool",
  "lsp", "lsp_tool", "lspTool", "LSPTool",
  "search", "tool_search", "ToolSearchTool",
  "list_dir", "list_directory",
  "session_list", "session_info", "session_read",
  "todo_write", "TodoWriteTool",
  "task_create", "task_get", "task_list", "task_update", "task_stop", "task_output",
  "send_message", "SendMessageTool",
  "sleep", "delay",
  "config", "config_tool",
]);

// ---------------------------------------------------------------------------
// Bash Command Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a bash command for risk level based on known dangerous patterns.
 * Returns the highest risk match with explanations.
 */
export function classifyBashCommand(command: string, cwd?: string): CommandClassification {
  if (!command || !command.trim()) {
    return { risk: "low", reason: "Empty command", dangerousPatterns: [], confidence: "high" };
  }

  const matches: Array<{ risk: CommandRisk; reason: string }> = [];

  for (const entry of DESTRUCTIVE_FILE_PATTERNS) {
    if (entry.pattern.test(command)) {
      matches.push({ risk: entry.risk, reason: entry.reason });
    }
  }

  // Check for cross-platform code exec patterns
  for (const exec of CROSS_PLATFORM_CODE_EXEC) {
    const execPattern = new RegExp(`(?:^|\\s+|\\|\\s*)(${exec})(?:\\s+|$)`);
    if (execPattern.test(command)) {
      // Only flag as dangerous if it's doing something non-trivial
      const args = command.replace(execPattern, "").trim();
      if (args.length > 10) {
        matches.push({
          risk: args.includes("-rf") || args.includes("rm") ? "high" : "medium",
          reason: `Running '${exec}' interpreter/runner with non-trivial arguments`,
        });
      }
      break; // Only count once per exec pattern
    }
  }

  // Check for single-char destructive commands
  if (/^rm\s+-rf\s+\S/.test(command)) {
    matches.push({ risk: "high", reason: "Recursive force deletion" });
  }

  if (matches.length === 0) {
    // Safe operations
    const safeCommands = ["ls", "cat", "head", "tail", "echo", "pwd", "which", "whoami",
      "date", "dirname", "basename", "type", "test", "true", "false", "cd", "mkdir",
      "npm build", "npm test", "npm run build", "git status", "git diff", "git log",
      "git branch", "git tag", "git fetch", "git pull"];
    const firstWord = command.trim().split(/\s+/)[0] ?? "";
    const isSafe = safeCommands.some(s => firstWord === s || command.startsWith(s));

    if (isSafe) {
      return { risk: "low", reason: "Recognized safe command", dangerousPatterns: [], confidence: "high" };
    }

    return { risk: "low", reason: "No dangerous patterns detected", dangerousPatterns: [], confidence: "medium" };
  }

  // Determine overall risk (highest match wins)
  const riskOrder: CommandRisk[] = ["critical", "high", "medium", "low"];
  const highestRisk = matches.reduce<CommandRisk>((max, m) => {
    return riskOrder.indexOf(m.risk) < riskOrder.indexOf(max) ? m.risk : max;
  }, "low");

  return {
    risk: highestRisk,
    reason: matches.map(m => m.reason).join("; ") || "Unknown dangerous pattern",
    dangerousPatterns: matches.map(m => m.reason),
    confidence: matches.some(m => m.risk === "critical" || m.risk === "high") ? "high" : "medium",
  };
}

/**
 * Determine if a tool is safe to auto-allow in YOLO mode (read-only, metadata-only).
 */
export function isSafeYoloTool(toolName: string): boolean {
  if (!toolName) return false;
  const normalized = toolName.trim().toLowerCase();
  if (SAFE_YOLO_TOOLS.has(normalized)) return true;
  if (normalized.startsWith("file_read") || normalized.startsWith("read_file")) return true;
  if (normalized.startsWith("task_")) return true;
  if (normalized.startsWith("mcp_") && normalized.includes("list")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Denial Tracking
// ---------------------------------------------------------------------------

const DENIAL_LIMITS = {
  maxConsecutive: 3,
  maxTotal: 20,
  cooldownMs: 30_000, // 30 seconds cooldown after fallback
} as const;

const DEFAULT_DENIAL_STATE: DenialTrackingState = {
  consecutiveDenials: 0,
  totalDenials: 0,
  lastDeniedAt: null,
  lastDeniedTool: null,
  fallbackTriggered: false,
};

export function createDenialTrackingState(): DenialTrackingState {
  return { ...DEFAULT_DENIAL_STATE };
}

export function recordPermissionDenial(state: DenialTrackingState, toolName: string): DenialTrackingState {
  const updated: DenialTrackingState = {
    ...state,
    consecutiveDenials: state.consecutiveDenials + 1,
    totalDenials: state.totalDenials + 1,
    lastDeniedAt: Date.now(),
    lastDeniedTool: toolName,
    fallbackTriggered: state.consecutiveDenials + 1 >= DENIAL_LIMITS.maxConsecutive
      || state.totalDenials + 1 >= DENIAL_LIMITS.maxTotal,
  };

  if (updated.fallbackTriggered && !state.fallbackTriggered) {
    logger.warn(`[permissions] Denial fallback triggered: ${updated.consecutiveDenials} consecutive, ${updated.totalDenials} total denials`);
  }

  return updated;
}

export function recordPermissionSuccess(state: DenialTrackingState): DenialTrackingState {
  if (state.consecutiveDenials === 0) return state;
  return { ...state, consecutiveDenials: 0 };
}

export function shouldFallbackToPrompting(state: DenialTrackingState): boolean {
  if (state.fallbackTriggered) {
    // Check if cooldown has passed
    if (state.lastDeniedAt && Date.now() - state.lastDeniedAt > DENIAL_LIMITS.cooldownMs) {
      return false; // Cooldown expired, resume normal operation
    }
    return true;
  }
  return state.consecutiveDenials >= DENIAL_LIMITS.maxConsecutive
    || state.totalDenials >= DENIAL_LIMITS.maxTotal;
}

// ---------------------------------------------------------------------------
// Permission Manager (Enhanced)
// ---------------------------------------------------------------------------

class PermissionManager {
  private config: PermissionConfig;
  private sessionPermissions: Map<string, { state: PermissionState; expiresAt: Date }> = new Map();
  private denialState: DenialTrackingState;
  private isYolo: boolean;

  constructor(yoloMode: boolean = false) {
    this.config = this.loadConfig();
    this.denialState = createDenialTrackingState();
    this.isYolo = yoloMode;
  }

  setYoloMode(yolo: boolean): void {
    this.isYolo = yolo;
    logger.info(`[permissions] YOLO mode ${yolo ? "enabled" : "disabled"}`);
  }

  getDenialState(): DenialTrackingState {
    return { ...this.denialState };
  }

  resetDenialState(): void {
    this.denialState = createDenialTrackingState();
  }

  private loadConfig(): PermissionConfig {
    try {
      if (fs.existsSync(PERMISSION_CONFIG_PATH)) {
        const raw = fs.readFileSync(PERMISSION_CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw) as Partial<PermissionConfig>;
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      logger.warn(`[tools/permissions] Failed to load config: ${err}`);
    }
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try {
      const dir = path.dirname(PERMISSION_CONFIG_PATH);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PERMISSION_CONFIG_PATH, JSON.stringify(this.config, null, 2), "utf-8");
    } catch (err) {
      logger.error(`[tools/permissions] Failed to save config: ${err}`);
    }
  }

  private getToolCategory(toolName: string): string {
    const categories = ["file", "shell", "mcp", "python"];
    for (const cat of categories) {
      if (toolName.startsWith(cat) || toolName.startsWith(`${cat}_`)) {
        return cat;
      }
    }
    return "mcp";
  }

  private isSessionExpired(entry: { state: PermissionState; expiresAt: Date }): boolean {
    return entry.expiresAt && new Date() > entry.expiresAt;
  }

  getDefaultState(toolName: string): PermissionState {
    const category = this.getToolCategory(toolName);
    return this.config.defaults[category] ?? "ask";
  }

  getToolOverride(toolName: string): PermissionState | null {
    return this.config.toolOverrides[toolName] ?? null;
  }

  getSessionPermission(toolName: string): PermissionState | null {
    const session = this.sessionPermissions.get(toolName);
    if (!session) return null;
    if (this.isSessionExpired(session)) {
      this.sessionPermissions.delete(toolName);
      return null;
    }
    return session.state;
  }

  getEffectiveState(toolName: string): PermissionState {
    const session = this.getSessionPermission(toolName);
    if (session) return session;

    const override = this.getToolOverride(toolName);
    if (override) return override;

    return this.getDefaultState(toolName);
  }

  /**
   * Classify a bash/shell command and return its risk assessment.
   * Falls back to basic pattern matching; no AI dependency.
   */
  classifyCommand(command: string): CommandClassification {
    return classifyBashCommand(command);
  }

  /**
   * Get enhanced risk for a tool+args combination.
   * For bash/shell tools, this uses the command classifier.
   */
  getCommandRisk(toolName: string, args: Record<string, unknown>): CommandRisk {
    const cat = this.getToolCategory(toolName);
    if (cat !== "shell") return "low";

    const command = String(args.command ?? args.cmd ?? args.script ?? "");
    if (!command || command === "undefined") return "low";

    const classification = classifyBashCommand(command);
    return classification.risk;
  }

  async requestPermission(
    tool: ToolDefinition<z.ZodSchema>,
    args: Record<string, unknown>
  ): Promise<boolean> {
    if (!tool.requiresPermission) {
      return true;
    }

    const toolName = tool.name;
    const state = this.getEffectiveState(toolName);

    // Check if denial fallback is active
    if (shouldFallbackToPrompting(this.denialState)) {
      logger.warn(`[permissions] Denial fallback active — forcing dialog for ${toolName}`);
      const allowed = await this.showPermissionDialog(tool, args);
      if (allowed) {
        this.denialState = recordPermissionSuccess(this.denialState);
      }
      return allowed;
    }

    switch (state) {
      case "allow":
        // In YOLO mode, still run classifier for shell commands
        if (this.isYolo && this.getToolCategory(toolName) === "shell") {
          const risk = this.getCommandRisk(toolName, args);
          if (risk === "critical") {
            logger.warn(`[permissions] YOLO mode blocked critical command: ${args.command ?? args.cmd ?? ""}`);
            return false;
          }
          if (risk === "high" && !isSafeYoloTool(toolName)) {
            logger.warn(`[permissions] YOLO mode escalated high-risk command to dialog: ${args.command ?? args.cmd ?? ""}`);
            return this.showPermissionDialog(tool, args);
          }
        }
        return true;

      case "deny":
        this.denialState = recordPermissionDenial(this.denialState, toolName);
        return false;

      case "ask": {
        const allowed = await this.showPermissionDialog(tool, args);
        if (allowed) {
          this.denialState = recordPermissionSuccess(this.denialState);
        } else {
          this.denialState = recordPermissionDenial(this.denialState, toolName);
        }
        return allowed;
      }
    }
  }

  async showPermissionDialog(
    tool: ToolDefinition<z.ZodSchema>,
    args: Record<string, unknown>
  ): Promise<boolean> {
    const toolName = tool.name;

    // Enhance the dialog with risk info for shell commands
    let what: string;
    if (this.getToolCategory(toolName) === "shell") {
      const command = String(args.command ?? args.cmd ?? "");
      const classification = classifyBashCommand(command);
      const riskTag = classification.risk === "critical" ? "[Siren]" : classification.risk === "high" ? "Warning:" : "";
      what = `${riskTag} ${toolName}: ${classification.reason}`.trim();
    } else {
      what = `Use ${toolName}: ${tool.description?.slice(0, 80) ?? "unknown action"}`;
    }

    return permissionGate.requestPermission(toolName, what, args);
  }

  getDenialStats(): { consecutive: number; total: number; fallbackActive: boolean } {
    return {
      consecutive: this.denialState.consecutiveDenials,
      total: this.denialState.totalDenials,
      fallbackActive: shouldFallbackToPrompting(this.denialState),
    };
  }

  setDefaultState(category: string, state: PermissionState): void {
    this.config.defaults[category] = state;
    this.saveConfig();
    logger.debug(`[tools/permissions] Set default ${category} to ${state}`);
  }

  setToolOverride(toolName: string, state: PermissionState): void {
    this.config.toolOverrides[toolName] = state;
    this.saveConfig();
    logger.debug(`[tools/permissions] Set override for ${toolName} to ${state}`);
  }

  setSessionPermission(toolName: string, state: PermissionState, rememberForSession: boolean = true): void {
    if (rememberForSession) {
      const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_SECONDS * 1000);
      this.sessionPermissions.set(toolName, { state, expiresAt });
    }
  }

  clearSessionPermissions(): void {
    this.sessionPermissions.clear();
  }

  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.sessionPermissions.clear();
    this.saveConfig();
  }
}

let permissionManagerInstance: PermissionManager | null = null;

export function getPermissionManager(yoloMode?: boolean): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager(yoloMode);
  }
  return permissionManagerInstance;
}

// ---------------------------------------------------------------------------
// Permission infrastructure exports
// ---------------------------------------------------------------------------

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "auto",
  "bubble",
]);

export function isValidMode(mode: string): mode is PermissionMode {
  return permissionModeSchema.safeParse(mode).success;
}

export function getModeConfig(mode: PermissionMode): {
  title: string;
  symbol: string;
  color: string;
} {
  switch (mode) {
    case "acceptEdits":
      return { title: "Accept edits", symbol: "", color: "autoAccept" };
    case "bypassPermissions":
      return { title: "Bypass Permissions", symbol: "", color: "error" };
    case "plan":
      return { title: "Plan Mode", symbol: "", color: "planMode" };
    case "auto":
      return { title: "Auto Mode", symbol: "", color: "warning" };
    case "bubble":
      return { title: "Bubble Mode", symbol: "", color: "warning" };
    case "default":
    default:
      return { title: "Default", symbol: "", color: "text" };
  }
}

export const modeTitle = (mode: PermissionMode) => getModeConfig(mode).title;
export const modeSymbol = (mode: PermissionMode) => getModeConfig(mode).symbol;
export const modeColor = (mode: PermissionMode) => getModeConfig(mode).color;

export function getEmptyToolPermissionContext(): ToolPermissionContext {
  return {
    mode: "default",
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    isAutoModeAvailable: true,
    strippedDangerousRules: undefined,
    shouldAvoidPermissionPrompts: false,
    awaitAutomatedChecksBeforeDialog: false,
    prePlanMode: undefined,
  };
}

export function permissionRuleSourceDisplayString(source: string): string {
  return source
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
    .replace("Cli Arg", "CLI argument");
}

function normalizeRuleArray(
  type: PermissionRule["type"],
  rulesBySource: ToolPermissionRulesBySource,
): PermissionRule[] {
  const out: PermissionRule[] = [];
  for (const [source, values] of Object.entries(rulesBySource) as Array<[keyof ToolPermissionRulesBySource, string[] | undefined]>) {
    for (const value of values ?? []) out.push({ type, value, source: source as any });
  }
  return out;
}

export function getAllowRules(ctx: ToolPermissionContext): PermissionRule[] {
  return normalizeRuleArray("allow", ctx.alwaysAllowRules);
}

export function getAskRules(ctx: ToolPermissionContext): PermissionRule[] {
  return normalizeRuleArray("ask", ctx.alwaysAskRules);
}

export function getDenyRules(ctx: ToolPermissionContext): PermissionRule[] {
  return normalizeRuleArray("deny", ctx.alwaysDenyRules);
}

export function resolvePermission(
  toolName: string,
  rulesBySource: ToolPermissionRulesBySource,
): { action: "allow" | "ask" | "deny"; reason: string } {
  const allRules = [
    ...normalizeRuleArray("deny", rulesBySource),
    ...normalizeRuleArray("allow", rulesBySource),
    ...normalizeRuleArray("ask", rulesBySource),
  ];

  const matched = allRules.find((rule) => {
    const parsed = permissionRuleValueFromString(rule.value);
    return parsed.toolName === toolName || parsed.toolName === "*";
  });

  if (!matched) return { action: "ask", reason: `${toolName} requires confirmation` };
  return {
    action: matched.type,
    reason: `${toolName} is ${matched.type}ed by ${permissionRuleSourceDisplayString(String(matched.source))}`,
  };
}

export type { PermissionManager, PermissionConfig, PermissionEntry };
