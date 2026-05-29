/**
 * Advanced Tools for Pakalon CLI
 * 
 * Contains Phase 2 tools:
 * - BriefTool: Summarization and message delivery to user
 * - ConfigTool: Configuration management
 * - SleepTool: Proactive scheduling/waiting
 * - TodoWriteTool: Todo list management
 * - ToolSearchTool: Dynamic tool discovery
 * - ScheduleCronTool: Cron job scheduling
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// BriefTool - Message Summarization & User Communication
// ---------------------------------------------------------------------------

export const briefToolSchema = z.object({
  message: z.string().describe("The message for the user. Supports markdown formatting."),
  attachments: z.array(z.string()).optional()
    .describe("Optional file paths to attach (photos, screenshots, diffs, logs)"),
  status: z.enum(["normal", "proactive"])
    .describe("Use 'proactive' for unsolicited updates, 'normal' for replies"),
});

export type BriefToolInput = z.infer<typeof briefToolSchema>;

export interface BriefToolOutput {
  message: string;
  attachments?: Array<{
    path: string;
    size: number;
    isImage: boolean;
  }>;
  sentAt: string;
}

interface AttachmentInfo {
  path: string;
  size: number;
  isImage: boolean;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

async function resolveAttachments(paths: string[]): Promise<AttachmentInfo[]> {
  const results: AttachmentInfo[] = [];
  
  for (const filePath of paths) {
    try {
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.resolve(process.cwd(), filePath);
      
      if (!fs.existsSync(absolutePath)) {
        logger.warn(`[brief] Attachment not found: ${filePath}`);
        continue;
      }

      const stats = await fs.promises.stat(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();
      
      results.push({
        path: absolutePath,
        size: stats.size,
        isImage: IMAGE_EXTENSIONS.has(ext),
      });
    } catch (error) {
      logger.error(`[brief] Error processing attachment ${filePath}: ${error}`);
    }
  }

  return results;
}

export async function executeBriefTool(input: BriefToolInput): Promise<BriefToolOutput> {
  const { message, attachments, status } = input;
  const sentAt = new Date().toISOString();

  logger.debug(`[brief] Sending ${status} message (${attachments?.length ?? 0} attachments)`);

  if (!attachments || attachments.length === 0) {
    return { message, sentAt };
  }

  const resolved = await resolveAttachments(attachments);
  return {
    message,
    attachments: resolved,
    sentAt,
  };
}

export const briefToolDefinition = {
  name: "brief",
  aliases: ["send_user_message"],
  description: "Send a message to the user with optional attachments",
  inputSchema: briefToolSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(input: BriefToolInput): Promise<BriefToolOutput> {
    return executeBriefTool(input);
  },
};

// ---------------------------------------------------------------------------
// ConfigTool - Configuration Management
// ---------------------------------------------------------------------------

export const configToolSchema = z.object({
  setting: z.string().describe("The setting key (e.g., 'theme', 'model', 'permissions.defaultMode')"),
  value: z.union([z.string(), z.boolean(), z.number()]).optional()
    .describe("The new value. Omit to get current value."),
});

export type ConfigToolInput = z.infer<typeof configToolSchema>;

export interface ConfigToolOutput {
  success: boolean;
  operation?: "get" | "set";
  setting?: string;
  value?: unknown;
  previousValue?: unknown;
  newValue?: unknown;
  error?: string;
}

// Supported settings registry
interface SettingConfig {
  type: "string" | "boolean" | "number" | "enum";
  options?: string[];
  description?: string;
  validate?: (value: unknown) => boolean;
}

const SUPPORTED_SETTINGS: Record<string, SettingConfig> = {
  "theme": {
    type: "enum",
    options: ["light", "dark", "system"],
    description: "Color theme for the CLI",
  },
  "model": {
    type: "string",
    description: "Default AI model to use",
  },
  "temperature": {
    type: "number",
    validate: (v) => typeof v === "number" && v >= 0 && v <= 2,
    description: "Model temperature (0-2)",
  },
  "maxTokens": {
    type: "number",
    validate: (v) => typeof v === "number" && v > 0,
    description: "Maximum tokens in response",
  },
  "permissions.defaultMode": {
    type: "enum",
    options: ["ask", "auto", "deny"],
    description: "Default permission mode for tool execution",
  },
  "autoCommit": {
    type: "boolean",
    description: "Automatically commit changes",
  },
  "verboseOutput": {
    type: "boolean",
    description: "Enable verbose output",
  },
  "editor": {
    type: "string",
    description: "Preferred code editor",
  },
  "shell": {
    type: "string",
    description: "Preferred shell",
  },
};

const CONFIG_FILE = ".pakalon-config.json";

function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".pakalon", CONFIG_FILE);
}

function loadConfig(): Record<string, unknown> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

async function saveConfig(config: Record<string, unknown>): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

export async function executeConfigTool(input: ConfigToolInput): Promise<ConfigToolOutput> {
  const { setting, value } = input;

  // Check if setting is supported
  if (!(setting in SUPPORTED_SETTINGS)) {
    return {
      success: false,
      error: `Unknown setting: "${setting}". Supported: ${Object.keys(SUPPORTED_SETTINGS).join(", ")}`,
    };
  }

  const config = loadConfig();
  const settingConfig = SUPPORTED_SETTINGS[setting]!;

  // GET operation
  if (value === undefined) {
    const currentValue = getNestedValue(config, setting);
    return {
      success: true,
      operation: "get",
      setting,
      value: currentValue,
    };
  }

  // SET operation
  // Validate type
  if (settingConfig.type === "enum" && settingConfig.options) {
    if (!settingConfig.options.includes(String(value))) {
      return {
        success: false,
        error: `Invalid value for ${setting}. Must be one of: ${settingConfig.options.join(", ")}`,
      };
    }
  }

  if (settingConfig.validate && !settingConfig.validate(value)) {
    return {
      success: false,
      error: `Invalid value for ${setting}`,
    };
  }

  const previousValue = getNestedValue(config, setting);
  setNestedValue(config, setting, value);
  await saveConfig(config);

  return {
    success: true,
    operation: "set",
    setting,
    previousValue,
    newValue: value,
  };
}

export const configToolDefinition = {
  name: "config",
  description: "Get or set Pakalon CLI configuration settings",
  inputSchema: configToolSchema,
  shouldDefer: true,
  isConcurrencySafe: true,
  isReadOnly: (input: ConfigToolInput) => input.value === undefined,

  async execute(input: ConfigToolInput): Promise<ConfigToolOutput> {
    return executeConfigTool(input);
  },
};

// ---------------------------------------------------------------------------
// SleepTool - Proactive Scheduling
// ---------------------------------------------------------------------------

export const sleepToolSchema = z.object({
  duration: z.number().min(0).max(300)
    .describe("Sleep duration in seconds (max 5 minutes)"),
  reason: z.string().optional()
    .describe("Reason for sleeping (for logging/debugging)"),
  interruptible: z.boolean().optional().default(true)
    .describe("Whether the sleep can be interrupted by the user"),
});

export type SleepToolInput = z.infer<typeof sleepToolSchema>;

export interface SleepToolOutput {
  sleptFor: number;
  reason?: string;
  resumedAt: string;
  interrupted: boolean;
  tickCount: number;
}

// Sleep controller for interruption support
const sleepAbortControllers: Map<string, AbortController> = new Map();

export function interruptSleep(id: string): boolean {
  const controller = sleepAbortControllers.get(id);
  if (controller) {
    controller.abort();
    sleepAbortControllers.delete(id);
    return true;
  }
  return false;
}

export function interruptAllSleeps(): void {
  for (const controller of sleepAbortControllers.values()) {
    controller.abort();
  }
  sleepAbortControllers.clear();
}

const TICK_INTERVAL_MS = 5000;

export async function executeSleepTool(input: SleepToolInput): Promise<SleepToolOutput> {
  const { duration, reason, interruptible = true } = input;
  const startTime = Date.now();
  const id = crypto.randomUUID();
  const controller = new AbortController();
  sleepAbortControllers.set(id, controller);

  const durationMs = duration * 1000;
  let tickCount = 0;

  logger.debug(`[sleep] Sleeping for ${duration}s${reason ? `: ${reason}` : ""} (id: ${id})`);

  try {
    await new Promise<void>((resolve, reject) => {
      // Set up tick interval for long sleeps
      let tickInterval: ReturnType<typeof setInterval> | null = null;
      if (durationMs > TICK_INTERVAL_MS) {
        tickInterval = setInterval(() => {
          tickCount++;
          logger.debug(`[sleep] Tick ${tickCount}`);
        }, TICK_INTERVAL_MS);
      }

      // Set up main sleep timeout
      const timeout = setTimeout(() => {
        if (tickInterval) clearInterval(tickInterval);
        resolve();
      }, durationMs);

      // Handle interruption
      if (interruptible) {
        controller.signal.addEventListener("abort", () => {
          if (tickInterval) clearInterval(tickInterval);
          clearTimeout(timeout);
          reject(new Error("Sleep interrupted"));
        });
      }
    });

    return {
      sleptFor: (Date.now() - startTime) / 1000,
      reason,
      resumedAt: new Date().toISOString(),
      interrupted: false,
      tickCount,
    };
  } catch (error) {
    const isInterrupted = error instanceof Error && error.message === "Sleep interrupted";
    if (isInterrupted) {
      logger.info(`[sleep] Sleep interrupted after ${(Date.now() - startTime) / 1000}s`);
    }
    return {
      sleptFor: (Date.now() - startTime) / 1000,
      reason,
      resumedAt: new Date().toISOString(),
      interrupted: isInterrupted,
      tickCount,
    };
  } finally {
    sleepAbortControllers.delete(id);
  }
}

export const sleepToolDefinition = {
  name: "sleep",
  description: "Pause execution for a specified duration. Supports interruption and periodic ticks.",
  inputSchema: sleepToolSchema,
  isReadOnly: true,

  async execute(input: SleepToolInput): Promise<SleepToolOutput> {
    return executeSleepTool(input);
  },
};

// ---------------------------------------------------------------------------
// TodoWriteTool - Todo List Management
// ---------------------------------------------------------------------------

export const todoItemSchema = z.object({
  id: z.string().describe("Unique identifier for the todo"),
  content: z.string().describe("Description of the task"),
  status: z.enum(["pending", "in_progress", "completed", "blocked"])
    .describe("Current status of the task"),
  priority: z.enum(["low", "medium", "high"]).optional()
    .describe("Task priority"),
  dependencies: z.array(z.string()).optional()
    .describe("IDs of tasks this depends on"),
});

export const todoWriteSchema = z.object({
  todos: z.array(todoItemSchema).describe("The updated todo list"),
});

export type TodoItem = z.infer<typeof todoItemSchema>;
export type TodoWriteInput = z.infer<typeof todoWriteSchema>;

export interface TodoWriteOutput {
  oldTodos: TodoItem[];
  newTodos: TodoItem[];
  completedCount: number;
  pendingCount: number;
}

// In-memory todo storage (would be persisted in production)
const todoStorage: Map<string, TodoItem[]> = new Map();

export function getTodos(sessionId: string): TodoItem[] {
  return todoStorage.get(sessionId) ?? [];
}

export function setTodos(sessionId: string, todos: TodoItem[]): void {
  todoStorage.set(sessionId, todos);
}

export async function executeTodoWriteTool(
  input: TodoWriteInput,
  sessionId: string
): Promise<TodoWriteOutput> {
  const { todos } = input;
  const oldTodos = getTodos(sessionId);

  // If all done, clear the list
  const allDone = todos.every(t => t.status === "completed");
  const newTodos = allDone ? [] : todos;

  setTodos(sessionId, newTodos);

  return {
    oldTodos,
    newTodos: todos,
    completedCount: todos.filter(t => t.status === "completed").length,
    pendingCount: todos.filter(t => t.status !== "completed").length,
  };
}

export const todoWriteToolDefinition = {
  name: "todo_write",
  description: "Update the session task/todo list",
  inputSchema: todoWriteSchema,
  shouldDefer: true,

  async execute(
    input: TodoWriteInput,
    context: { sessionId: string }
  ): Promise<TodoWriteOutput> {
    return executeTodoWriteTool(input, context.sessionId);
  },
};

// ---------------------------------------------------------------------------
// ToolSearchTool - Dynamic Tool Discovery
// ---------------------------------------------------------------------------

export const toolSearchSchema = z.object({
  query: z.string().describe("Search query for tool capabilities"),
  category: z.enum(["all", "file", "shell", "git", "mcp", "agent"]).optional()
    .describe("Filter by tool category"),
});

export type ToolSearchInput = z.infer<typeof toolSearchSchema>;

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  isEnabled: boolean;
}

export interface ToolSearchOutput {
  tools: ToolInfo[];
  totalCount: number;
  query: string;
}

// Tool registry for search
const KNOWN_TOOLS: ToolInfo[] = [
  { name: "bash", description: "Execute shell commands", category: "shell", isEnabled: true },
  { name: "powershell", description: "Execute PowerShell commands on Windows", category: "shell", isEnabled: true },
  { name: "file_read", description: "Read file contents", category: "file", isEnabled: true },
  { name: "file_write", description: "Write file contents", category: "file", isEnabled: true },
  { name: "file_edit", description: "Edit file with search/replace", category: "file", isEnabled: true },
  { name: "glob", description: "Find files by pattern", category: "file", isEnabled: true },
  { name: "grep", description: "Search file contents with regex", category: "file", isEnabled: true },
  { name: "git_status", description: "Get git repository status", category: "git", isEnabled: true },
  { name: "git_diff", description: "Show git diff", category: "git", isEnabled: true },
  { name: "git_commit", description: "Create a git commit", category: "git", isEnabled: true },
  { name: "mcp_tool", description: "Execute MCP server tools", category: "mcp", isEnabled: true },
  { name: "list_mcp_resources", description: "List MCP server resources", category: "mcp", isEnabled: true },
  { name: "read_mcp_resource", description: "Read MCP server resource", category: "mcp", isEnabled: true },
  { name: "team_create", description: "Create multi-agent team", category: "agent", isEnabled: true },
  { name: "team_delete", description: "Delete agent team", category: "agent", isEnabled: true },
  { name: "send_message", description: "Send message to agent", category: "agent", isEnabled: true },
  { name: "task_create", description: "Create background task", category: "agent", isEnabled: true },
  { name: "task_get", description: "Get task status", category: "agent", isEnabled: true },
  { name: "brief", description: "Send message to user", category: "all", isEnabled: true },
  { name: "config", description: "Manage CLI configuration", category: "all", isEnabled: true },
  { name: "web_fetch", description: "Fetch URL content", category: "all", isEnabled: true },
];

export function executeToolSearch(input: ToolSearchInput): ToolSearchOutput {
  const { query, category = "all" } = input;
  const lowerQuery = query.toLowerCase();

  let filtered = KNOWN_TOOLS;

  // Filter by category
  if (category !== "all") {
    filtered = filtered.filter(t => t.category === category);
  }

  // Search by name and description
  filtered = filtered.filter(t =>
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery)
  );

  return {
    tools: filtered,
    totalCount: filtered.length,
    query,
  };
}

export const toolSearchToolDefinition = {
  name: "tool_search",
  description: "Search for available tools by capability",
  inputSchema: toolSearchSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  execute(input: ToolSearchInput): ToolSearchOutput {
    return executeToolSearch(input);
  },
};

// ---------------------------------------------------------------------------
// ScheduleCronTool - Cron Job Scheduling
// ---------------------------------------------------------------------------

export const cronJobSchema = z.object({
  action: z.enum(["create", "list", "delete", "run"]).describe("Action to perform"),
  jobId: z.string().optional().describe("Job ID for delete/run actions"),
  schedule: z.string().optional().describe("Cron expression (e.g., '0 * * * *' for hourly)"),
  command: z.string().optional().describe("Command to execute"),
  description: z.string().optional().describe("Job description"),
});

export type CronJobInput = z.infer<typeof cronJobSchema>;

export interface CronJob {
  id: string;
  schedule: string;
  command: string;
  description?: string;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
}

export interface CronJobOutput {
  success: boolean;
  action: string;
  job?: CronJob;
  jobs?: CronJob[];
  message?: string;
  error?: string;
}

// In-memory cron storage
const cronJobs: Map<string, CronJob> = new Map();

function parseCronExpression(expression: string): number | null {
  // Simplified cron parser - returns next run time in ms
  // Full implementation would use a library like 'cron-parser'
  const parts = expression.split(" ");
  if (parts.length !== 5) return null;

  const now = new Date();
  // Simple: assume next hour for * * * * *
  const next = new Date(now);
  next.setMinutes(next.getMinutes() + 1);
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  return next.getTime();
}

export function executeCronJob(input: CronJobInput): CronJobOutput {
  const { action, jobId, schedule, command, description } = input;

  switch (action) {
    case "create": {
      if (!schedule || !command) {
        return {
          success: false,
          action,
          error: "schedule and command are required for create",
        };
      }

      const nextRun = parseCronExpression(schedule);
      if (nextRun === null) {
        return {
          success: false,
          action,
          error: "Invalid cron expression",
        };
      }

      const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job: CronJob = {
        id,
        schedule,
        command,
        description,
        createdAt: Date.now(),
        nextRun,
        enabled: true,
      };

      cronJobs.set(id, job);
      
      return {
        success: true,
        action,
        job,
        message: `Created cron job ${id}`,
      };
    }

    case "list": {
      return {
        success: true,
        action,
        jobs: Array.from(cronJobs.values()),
      };
    }

    case "delete": {
      if (!jobId) {
        return {
          success: false,
          action,
          error: "jobId is required for delete",
        };
      }

      if (!cronJobs.has(jobId)) {
        return {
          success: false,
          action,
          error: `Job ${jobId} not found`,
        };
      }

      cronJobs.delete(jobId);
      return {
        success: true,
        action,
        message: `Deleted job ${jobId}`,
      };
    }

    case "run": {
      if (!jobId) {
        return {
          success: false,
          action,
          error: "jobId is required for run",
        };
      }

      const job = cronJobs.get(jobId);
      if (!job) {
        return {
          success: false,
          action,
          error: `Job ${jobId} not found`,
        };
      }

      // Mark as last run (actual execution would be async)
      job.lastRun = Date.now();
      job.nextRun = parseCronExpression(job.schedule) ?? undefined;

      return {
        success: true,
        action,
        job,
        message: `Triggered job ${jobId}`,
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

export const cronToolDefinition = {
  name: "schedule_cron",
  description: "Manage scheduled/cron jobs",
  inputSchema: cronJobSchema,

  execute(input: CronJobInput): CronJobOutput {
    return executeCronJob(input);
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  // Brief Tool
  briefToolSchema,
  briefToolDefinition,
  executeBriefTool,

  // Config Tool
  configToolSchema,
  configToolDefinition,
  executeConfigTool,
  loadConfig,
  saveConfig,

  // Sleep Tool
  sleepToolSchema,
  sleepToolDefinition,
  executeSleepTool,

  // Todo Write Tool
  todoItemSchema,
  todoWriteSchema,
  todoWriteToolDefinition,
  executeTodoWriteTool,
  getTodos,
  setTodos,

  // Tool Search Tool
  toolSearchSchema,
  toolSearchToolDefinition,
  executeToolSearch,

  // Cron Tool
  cronJobSchema,
  cronToolDefinition,
  executeCronJob,
};
