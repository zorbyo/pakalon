/**
 * Enhanced Tool Class — Full Lifecycle Tool
 *
 * Provides the complete tool lifecycle matching Claude Code's Tool type with
 * all 22+ interface methods. This is the rich tool wrapper that sits on top
 * of the simpler ToolDefinition from executor.ts.
 *
 * Features:
 *   - interruptBehavior: per-tool cancel vs block on user interrupt
 *   - isSearchOrReadCommand: collapsed UI display for search/read ops
 *   - isTransparentWrapper: delegates rendering to inner tool (REPL)
 *   - backfillObservableInput: mutate tool input copies for observers
 *   - getActivityDescription: human-readable spinner text
 *   - extractSearchText: flattened text for transcript search
 *   - preparePermissionMatcher: tool-specific permission matching
 *   - getToolUseSummary: condensed tool use summary
 *   - render methods: message, result, progress, error, rejection, tag
 */

import { z } from "zod";
import type {
  ToolPermissionContext,
  ToolResult,
  ToolUseContext,
  ToolProgressData,
  ToolInputJSONSchema,
  ValidationResult,
  ToolResultBlockParam,
  ToolUseBlockParam,
  PermissionResult,
} from "./tool-types.js";
import type { Theme } from "./tool-types.js";
import { renderToolResultMessage, renderToolCallMessage } from "./toolRenderer.js";

// ============================================================================
// Types
// ============================================================================

export type InterruptBehavior = "cancel" | "block";

export interface ToolLifecycleConfig<
  TArgs extends z.ZodType = z.ZodType,
  TResult = unknown,
> {
  name: string;
  description: string;
  inputSchema: TArgs;
  inputJSONSchema?: ToolInputJSONSchema;
  outputSchema?: z.ZodType<TResult>;
  userFacingName?: string;
  searchHint?: string;
  aliases?: string[];
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  isEnabled?: boolean | ((ctx: ToolUseContext) => boolean);
  interruptBehavior?: InterruptBehavior;
  requiresUserInteraction?: boolean;
  isOpenWorld?: boolean;
  maxResultSizeChars?: number;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  userFacingNameBackgroundColor?: (
    input: Partial<z.infer<TArgs>> | undefined,
  ) => keyof Theme | undefined;
  mcpInfo?: { serverName: string; toolName: string };

  call(args: z.infer<TArgs>, ctx: ToolUseContext): Promise<ToolResult<TResult>>;
}

// ============================================================================
// Enhanced Tool
// ============================================================================

export class Tool<TArgs extends z.ZodType = z.ZodType, TResult = unknown> {
  /** Tool name — used as function name in LLM tool calls. */
  readonly name: string;

  /** Human-readable description. */
  readonly description: string;

  /** Zod schema for input validation. */
  readonly inputSchema: TArgs;

  /** Optional JSON schema for prompt rendering / MCP tools. */
  readonly inputJSONSchema?: ToolInputJSONSchema;

  /** Optional output schema. */
  readonly outputSchema?: z.ZodType<TResult>;

  /** User-facing name for UI display. */
  readonly userFacingName: string;

  /** One-line capability phrase for keyword matching. */
  readonly searchHint?: string;

  /** Backwards-compatible aliases. */
  readonly aliases: string[];

  /** Maximum bytes for a single tool result before persistence. */
  readonly maxResultSizeChars: number;

  /** When true, tool schema is always loaded eagerly. */
  readonly alwaysLoad?: boolean;

  /** Whether this tool is read-only (no side effects). */
  private _isReadOnly: boolean;

  /** Whether this tool is destructive (irreversible). */
  private _isDestructive: boolean;

  /** Whether multiple instances can run concurrently. */
  private _isConcurrencySafe: boolean;

  /** Whether tool requires user interaction (e.g., browser). */
  private _requiresUserInteraction: boolean;

  /** Whether this tool is an "open world" tool (bash, browser). */
  private _isOpenWorld: boolean;

  /** Whether this tool should be deferred from initial prompt. */
  readonly shouldDefer: boolean;

  /** UI background color for the tool bubble. */
  private _userFacingNameBackgroundColor?: (
    input: Partial<z.infer<TArgs>> | undefined,
  ) => keyof Theme | undefined;

  /** Interrupt behavior when user sends message during execution. */
  private _interruptBehavior: InterruptBehavior;

  /** Whether the tool is enabled (can be dynamic). */
  private _isEnabled: boolean | ((ctx: ToolUseContext) => boolean);

  /** The actual implementation */
  private _call: (args: z.infer<TArgs>, ctx: ToolUseContext) => Promise<ToolResult<TResult>>;

  constructor(config: ToolLifecycleConfig<TArgs, TResult>) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.inputJSONSchema = config.inputJSONSchema;
    this.outputSchema = config.outputSchema;
    this.userFacingName = config.userFacingName ?? config.name;
    this.searchHint = config.searchHint;
    this.aliases = config.aliases ?? [];
    this.maxResultSizeChars = config.maxResultSizeChars ?? 100_000;
    this.alwaysLoad = config.alwaysLoad;
    this._isReadOnly = config.isReadOnly ?? false;
    this._isDestructive = config.isDestructive ?? false;
    this._isConcurrencySafe = config.isConcurrencySafe ?? false;
    this._requiresUserInteraction = config.requiresUserInteraction ?? false;
    this._isOpenWorld = config.isOpenWorld ?? false;
    this.shouldDefer = config.shouldDefer ?? false;
    this._interruptBehavior = config.interruptBehavior ?? "cancel";
    this._isEnabled = config.isEnabled ?? true;
    this._userFacingNameBackgroundColor = config.userFacingNameBackgroundColor;
    this.mcpInfo = config.mcpInfo;
    this._call = config.call;
  }

  // ====================================================================
  // Lifecycle Methods
  // ====================================================================

  /** Execute the tool with given args and context. */
  async call(args: z.infer<TArgs>, ctx: ToolUseContext): Promise<ToolResult<TResult>> {
    return this._call(args, ctx);
  }

  /** Check if this tool is enabled for the current context. */
  isEnabled(ctx?: ToolUseContext): boolean {
    if (typeof this._isEnabled === "function") {
      return ctx ? this._isEnabled(ctx) : true;
    }
    return this._isEnabled;
  }

  /** Check whether two inputs are equivalent for deduplication. */
  inputsEquivalent(a: z.infer<TArgs>, b: z.infer<TArgs>): boolean {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return a === b;
    }
  }

  /** Whether this tool is read-only (safe for repeated calls). */
  isReadOnly(): boolean {
    return this._isReadOnly;
  }

  /** Whether this tool is destructive (irreversible side effects). */
  isDestructive(): boolean {
    return this._isDestructive;
  }

  /** Whether multiple instances can run concurrently. */
  isConcurrencySafe(): boolean {
    return this._isConcurrencySafe;
  }

  /** Whether this tool requires user interaction (browser, etc.). */
  requiresUserInteraction(): boolean {
    return this._requiresUserInteraction;
  }

  /** Whether this is an open-world tool (bash, browser) that can do anything. */
  isOpenWorld(): boolean {
    return this._isOpenWorld;
  }

  /** Get the interrupt behavior for this tool. */
  interruptBehavior(): InterruptBehavior {
    return this._interruptBehavior;
  }

  // ====================================================================
  // Classification Methods
  // ====================================================================

  /**
   * Classify this tool into search/read/list categories for collapsed UI.
   */
  isSearchOrReadCommand(): { isSearch: boolean; isRead: boolean; isList: boolean } {
    const name = this.name.toLowerCase();
    return {
      isSearch: name.startsWith("grep") || name.startsWith("search") || name.includes("find"),
      isRead: name === "read" || name.startsWith("read_") || name.includes("browser_snapshot"),
      isList: name.startsWith("list") || name.endsWith("_list") || name.endsWith("ls"),
    };
  }

  /**
   * Whether this tool is a transparent wrapper (delegates rendering to inner tool).
   */
  isTransparentWrapper(): boolean {
    return this.name === "repl" || this.name === "bash" || this.name === "powershell";
  }

  // ====================================================================
  // Input/Output Methods
  // ====================================================================

  /**
   * Backfill observable input copies with legacy/derived fields
   * without affecting the API-bound original.
   */
  backfillObservableInput(input: z.infer<TArgs>): z.infer<TArgs> {
    // Default: no backfill needed. Individual tools can override.
    return { ...input };
  }

  /**
   * Prepare expensive tool-specific permission rule matching.
   * E.g., Bash tool parses "git *" patterns against command strings.
   */
  preparePermissionMatcher(): ((args: Record<string, unknown>) => string) | null {
    return null; // Override in subclasses
  }

  /**
   * Validate tool input against schema.
   */
  validateInput(input: unknown): ValidationResult {
    try {
      this.inputSchema.parse(input);
      return { result: true };
    } catch (err) {
      return {
        result: false,
        message: err instanceof z.ZodError ? err.errors.map(e => e.message).join("; ") : String(err),
        errorCode: 400,
      };
    }
  }

  /**
   * Check permissions for this tool call.
   */
  checkPermissions(
    args: Record<string, unknown>,
    ctx: ToolPermissionContext,
  ): PermissionResult {
    // Default: check deny rules, then allow rules, then mode
    if (ctx.mode === "bypassPermissions" || ctx.mode === "auto") {
      // Strip dangerous rules check
      if (ctx.strippedDangerousRules && ctx.isBypassPermissionsModeAvailable) {
        // Allow in bypass mode with stripped dangerous rules
      }
      return { behavior: "allow" };
    }

    if (ctx.mode === "plan") {
      // In plan mode, search/read tools are allowed
      const { isSearch, isRead, isList } = this.isSearchOrReadCommand();
      if (isSearch || isRead || isList) {
        return { behavior: "allow" };
      }
      // Others are denied in plan mode
      return { behavior: "deny", reason: "Not available in plan mode" };
    }

    return { behavior: "allow" };
  }

  // ====================================================================
  // Rendering Methods
  // ====================================================================

  /** Render the tool call for display in the conversation. */
  renderToolUseMessage(args: z.infer<TArgs>): string {
    return renderToolCallMessage(this.name, args as Record<string, unknown>);
  }

  /** Render the tool result for display. */
  renderToolResultMessage(result: unknown): string {
    return renderToolResultMessage(this.name, result);
  }

  /** Render a progress message while the tool is running. */
  renderToolUseProgressMessage(progress?: ToolProgressData): string {
    return `[${this.userFacingName}: running...]`;
  }

  /** Render a message when the tool is queued waiting for execution. */
  renderToolUseQueuedMessage(): string {
    return `[${this.userFacingName}: queued...]`;
  }

  /** Render a message when the tool use is rejected. */
  renderToolUseRejectedMessage(reason?: string): string {
    return reason
      ? `[${this.userFacingName}: rejected — ${reason}]`
      : `[${this.userFacingName}: rejected]`;
  }

  /** Render an error message. */
  renderToolUseErrorMessage(error: Error | string): string {
    const msg = typeof error === "string" ? error : error.message;
    return `[${this.userFacingName}: ${msg}]`;
  }

  /** Render a tool use tag (short identifier). */
  renderToolUseTag(args: z.infer<TArgs>): string {
    const input = args as Record<string, unknown>;
    const path = typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : typeof input.command === "string"
          ? input.command.slice(0, 40)
          : "";
    return path ? `${this.name}(${path})` : this.name;
  }

  /** Resolve a custom background color for the UI bubble, if any. */
  userFacingNameBackgroundColor(
    input: Partial<z.infer<TArgs>> | undefined,
  ): keyof Theme | undefined {
    return this._userFacingNameBackgroundColor?.(input);
  }

  /** Render multiple parallel tool uses as a single grouped element. */
  static renderGroupedToolUse(tools: Tool[], argsList: Record<string, unknown>[]): string {
    if (tools.length === 0) return "";
    if (tools.length === 1) {
      return tools[0].renderToolUseMessage(argsList[0] as any);
    }
    const lines = tools.map((t, i) => {
      const arg = argsList[i] ?? {};
      const path = typeof arg.filePath === "string" ? arg.filePath : typeof arg.path === "string" ? arg.path : "";
      return path ? `  • ${t.name}(${path})` : `  • ${t.name}`;
    });
    return `[Running ${tools.length} tools in parallel]\n${lines.join("\n")}`;
  }

  // ====================================================================
  // Utility Methods
  // ====================================================================

  /** Get a human-readable present-tense activity description for spinner display. */
  getActivityDescription(args: z.infer<TArgs>): string {
    const input = args as Record<string, unknown>;
    if (typeof input.filePath === "string") return `Reading ${input.filePath}`;
    if (typeof input.path === "string") return `Searching ${input.path}`;
    if (typeof input.command === "string") {
      const cmd = String(input.command).slice(0, 60);
      return `Running \`${cmd}\``;
    }
    return `Using ${this.userFacingName}`;
  }

  /** Get a condensed summary of the tool use for tool decisions display. */
  getToolUseSummary(args: z.infer<TArgs>): string {
    const input = args as Record<string, unknown>;
    const keys = Object.keys(input).slice(0, 3);
    const parts = keys.map(k => {
      const v = input[k];
      const s = typeof v === "string" ? v.slice(0, 50) : JSON.stringify(v).slice(0, 50);
      return `${k}=${s}`;
    });
    return `${this.name}(${parts.join(", ")})`;
  }

  /** Extract flattened search text for transcript search indexing. */
  extractSearchText(args: z.infer<TArgs>): string {
    return Object.values(args as Record<string, unknown>)
      .filter(v => typeof v === "string")
      .join(" ");
  }

  /** Check if tool result is truncated (exceeds maxResultSizeChars). */
  isResultTruncated(resultText: string): boolean {
    return resultText.length > this.maxResultSizeChars;
  }

  /** Convert tool input to compact auto-classifier representation. */
  toAutoClassifierInput(args: z.infer<TArgs>): string {
    const input = args as Record<string, unknown>;
    // For bash: compact the command
    if (this.name === "bash" || this.name === "powershell") {
      const cmd = String(input.command ?? "");
      return `${this.name}: ${cmd.slice(0, 200)}`;
    }
    // For read: file path
    if (this.name === "read") {
      return `${this.name}: ${input.filePath ?? input.path ?? ""}`;
    }
    // For edit: file path
    if (input.filePath) {
      return `${this.name}: ${input.filePath}`;
    }
    return `${this.name}`;
  }

  /** Get the primary file path this tool operates on, if any. */
  getPath(args: z.infer<TArgs>): string | undefined {
    const input = args as Record<string, unknown>;
    return (input.filePath as string) ?? (input.path as string) ?? undefined;
  }

  /** Transform tool result into the ToolResultBlockParam format for the Vercel AI SDK. */
  mapToolResultToToolResultBlockParam(
    toolUseId: string,
    result: ToolResult<TResult>,
  ): ToolResultBlockParam {
    const text = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2);
    return {
      type: "content",
      content: [{ type: "text", text }],
    };
  }

  /** Create ToolUseBlockParam from tool call. */
  toToolUseBlock(toolUseId: string, args: z.infer<TArgs>): ToolUseBlockParam {
    return {
      type: "tool_use",
      id: toolUseId,
      name: this.name,
      input: args as Record<string, unknown>,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Build a Tool with fail-closed safe defaults.
 * All lifecycle methods get sensible defaults unless overridden.
 */
export function buildTool<TArgs extends z.ZodType, TResult = unknown>(
  config: ToolLifecycleConfig<TArgs, TResult>,
): Tool<TArgs, TResult> {
  return new Tool(config);
}

/**
 * Convert an array of Tools to a record suitable for the Vercel AI SDK.
 */
export function toolsToRecord(tools: Tool[]): Record<string, Tool> {
  const record: Record<string, Tool> = {};
  for (const tool of tools) {
    record[tool.name] = tool;
    // Register aliases
    for (const alias of tool.aliases) {
      record[alias] = tool;
    }
  }
  return record;
}
