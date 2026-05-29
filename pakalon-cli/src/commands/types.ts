/**
 * Command Types for Pakalon CLI
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

export interface CommandContext {
  /** Current conversation messages */
  messages?: unknown[];
  
  /** Session options */
  options?: {
    commands?: CommandDefinition[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
  
  /** Callback when command completes */
  onDone?: (message?: string) => void;
  
  /** Current working directory */
  cwd?: string;
  
  /** User info */
  user?: {
    id: string;
    name?: string;
    email?: string;
  };
  
  /** Feature flags */
  features?: Record<string, boolean>;

  /** Track command start for UI indicator */
  startCommand?: (commandName: string) => void;

  /** Track command completion for UI indicator */
  completeCommand?: (commandName: string) => void;
  
  /** Additional context data */
  [key: string]: unknown;
}

export interface CommandResult {
  /** Whether command succeeded */
  success: boolean;
  
  /** Human-readable message */
  message?: string;
  
  /** Structured output data */
  data?: Record<string, unknown>;
  
  /** Error details if failed */
  error?: string;
  
  /** Whether to continue REPL */
  continueRepl?: boolean;
}

// ---------------------------------------------------------------------------
// Command Definition
// ---------------------------------------------------------------------------

export interface CommandDefinition {
  /** Primary command name */
  name: string;
  
  /** Alternative names */
  aliases?: string[];
  
  /** Short description */
  description: string;
  
  /** Usage example */
  usage?: string;
  
  /** Category for grouping */
  category?: CommandCategory;
  
  /** Whether to hide from help */
  hidden?: boolean;
  
  /** Whether command is experimental */
  experimental?: boolean;
  
  /** Required permissions */
  permissions?: CommandPermission[];
  
  /** Execute the command */
  execute: (context: CommandContext, args: string[]) => Promise<CommandResult>;
  
  /** Argument completion */
  complete?: (partial: string, context: CommandContext) => string[];
}

// ---------------------------------------------------------------------------
// Categories and Permissions
// ---------------------------------------------------------------------------

export type CommandCategory =
  | "session"
  | "navigation"
  | "project"
  | "agents"
  | "workflow"
  | "integrations"
  | "plugins"
  | "model"
  | "config"
  | "mcp"
  | "git"
  | "auth"
  | "account"
  | "ui"
  | "info"
  | "advanced"
  | "debug"
  | "internal";

export type CommandPermission =
  | "read"
  | "write"
  | "execute"
  | "admin"
  | "network"
  | "filesystem";

// ---------------------------------------------------------------------------
// Local Command Types
// ---------------------------------------------------------------------------

export interface LocalCommandCall {
  type: "local";
  name: string;
  args: string[];
  context: CommandContext;
  onDone: (result: CommandResult) => void;
}

export interface LocalJSXCommandCall {
  type: "jsx";
  name: string;
  args: string[];
  context: CommandContext;
  render: () => unknown; // React element
}

// ---------------------------------------------------------------------------
// Command Registry Types
// ---------------------------------------------------------------------------

export interface CommandRegistration {
  definition: CommandDefinition;
  source: "builtin" | "plugin" | "skill" | "custom";
  priority: number;
}

export interface CommandMatch {
  command: CommandDefinition;
  args: string[];
  matchType: "exact" | "alias" | "prefix";
}

// ---------------------------------------------------------------------------
// Async Command Types
// ---------------------------------------------------------------------------

export interface AsyncCommandState {
  id: string;
  command: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  result?: CommandResult;
  startedAt: number;
  completedAt?: number;
}

export interface StreamingCommandOutput {
  type: "stdout" | "stderr" | "status" | "progress";
  data: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

export type CommandHandler = CommandDefinition["execute"];

export type CommandCompleter = NonNullable<CommandDefinition["complete"]>;

export interface ParsedCommand {
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
  raw: string;
}

// ---------------------------------------------------------------------------
// Export All
// ---------------------------------------------------------------------------

export default {
  // Re-export types for convenience
};
