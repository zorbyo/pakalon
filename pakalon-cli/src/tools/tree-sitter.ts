/**
 * Tree-sitter WASM parser for shell command analysis.
 * Matches Copilot CLI's tree-sitter-bash.wasm + tree-sitter-powershell.wasm approach.
 *
 * Provides:
 * - Command name extraction
 * - File path extraction from arguments
 * - Output redirection detection
 * - Variable expansion detection
 * - Dangerous pattern identification
 */
import logger from "@/utils/logger.js";
import { detectDangerousPatterns, type DangerousPattern } from "./bash.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  /** The primary command name (e.g., "ls", "git", "npm") */
  command: string;
  /** All arguments */
  args: string[];
  /** File paths referenced in the command */
  paths: string[];
  /** Whether the command has output redirection (>, >>) */
  hasRedirection: boolean;
  /** Redirect target file, if any */
  redirectTarget?: string;
  /** Whether the command has pipes */
  hasPipes: boolean;
  /** Subcommands extracted from pipes */
  pipeCommands: string[];
  /** Variable expansions found */
  variables: string[];
  /** Command substitutions found */
  commandSubstitutions: string[];
  /** Detected dangerous patterns */
  dangerousPatterns: DangerousPattern[];
}

// ---------------------------------------------------------------------------
// Parser State
// ---------------------------------------------------------------------------

let treeSitterLoaded = false;
let Parser: any = null;
let BashLanguage: any = null;
let PowerShellLanguage: any = null;

/**
 * Initialize tree-sitter with WASM grammars.
 * This is called lazily on first use.
 */
export async function initTreeSitter(): Promise<boolean> {
  if (treeSitterLoaded) return true;

  try {
    const webTreeSitter = await import("web-tree-sitter");
    // web-tree-sitter init pattern
    if (typeof (webTreeSitter as any).default?.init === "function") {
      await (webTreeSitter as any).default.init();
      Parser = (webTreeSitter as any).default;
    } else if (typeof (webTreeSitter as any).init === "function") {
      await (webTreeSitter as any).init();
      Parser = webTreeSitter;
    } else {
      Parser = webTreeSitter;
    }

    // Try to load bash grammar
    try {
      // web-tree-sitter loads .wasm files from node_modules
      const bashPath = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm").replace(/\\/g, "/");
      BashLanguage = await Parser.Language.load(bashPath);
      logger.info("[tree-sitter] Bash grammar loaded");
    } catch (err) {
      logger.warn("[tree-sitter] Failed to load bash grammar, using regex fallback", {
        error: String(err),
      });
    }

    treeSitterLoaded = true;
    return true;
  } catch (err) {
    logger.warn("[tree-sitter] Failed to initialize, using regex fallback", {
      error: String(err),
    });
    treeSitterLoaded = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tree-sitter AST Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a shell command using tree-sitter AST.
 * Falls back to regex parsing if tree-sitter is unavailable.
 */
export async function parseShellCommand(command: string): Promise<ParsedCommand> {
  const initialized = await initTreeSitter();

  if (initialized && BashLanguage) {
    return parseWithTreeSitter(command);
  }

  return parseWithRegex(command);
}

/**
 * Parse using tree-sitter AST (preferred).
 */
function parseWithTreeSitter(command: string): ParsedCommand {
  try {
    const parser = new Parser();
    parser.setLanguage(BashLanguage);
    const tree = parser.parse(command);

    const result: ParsedCommand = {
      command: "",
      args: [],
      paths: [],
      hasRedirection: false,
      hasPipes: false,
      pipeCommands: [],
      variables: [],
      commandSubstitutions: [],
      dangerousPatterns: detectDangerousPatterns(command),
    };

    // Walk the AST to extract information
    walkNode(tree.rootNode, result, command);

    // Extract primary command name from first token
    if (!result.command && result.args.length > 0) {
      result.command = result.args[0] ?? "";
    }

    return result;
  } catch (err) {
    logger.warn("[tree-sitter] AST parse failed, falling back to regex", {
      error: String(err),
    });
    return parseWithRegex(command);
  }
}

function walkNode(node: any, result: ParsedCommand, source: string): void {
  const nodeType = node.type;

  switch (nodeType) {
    case "command_name":
    case "command": {
      const text = source.slice(node.startIndex, node.endIndex);
      if (!result.command) {
        result.command = text.trim().split(/\s+/)[0] ?? "";
      }
      break;
    }

    case "word": {
      const text = source.slice(node.startIndex, node.endIndex);
      if (text && !result.args.includes(text)) {
        result.args.push(text);
      }
      // Detect file paths
      if (text.includes("/") || text.includes("\\") || text.includes(".")) {
        if (!text.startsWith("-") && !text.startsWith("$")) {
          result.paths.push(text);
        }
      }
      break;
    }

    case "string":
    case "raw_string": {
      const text = source.slice(node.startIndex, node.endIndex);
      // Remove quotes
      const unquoted = text.replace(/^['"]|['"]$/g, "");
      if (unquoted.includes("/") || unquoted.includes("\\")) {
        result.paths.push(unquoted);
      }
      break;
    }

    case "file_redirect": {
      result.hasRedirection = true;
      // Extract redirect target
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === "word" || child?.type === "string") {
          result.redirectTarget = source.slice(child.startIndex, child.endIndex);
        }
      }
      break;
    }

    case "pipe": {
      result.hasPipes = true;
      break;
    }

    case "variable_assignment":
    case "simple_expansion":
    case "expansion": {
      const text = source.slice(node.startIndex, node.endIndex);
      result.variables.push(text);
      break;
    }

    case "command_substitution": {
      const text = source.slice(node.startIndex, node.endIndex);
      result.commandSubstitutions.push(text);
      break;
    }
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkNode(child, result, source);
    }
  }
}

// ---------------------------------------------------------------------------
// Regex Fallback Parser
// ---------------------------------------------------------------------------

/**
 * Parse a shell command using regex patterns (fallback when tree-sitter unavailable).
 */
function parseWithRegex(command: string): ParsedCommand {
  const trimmed = command.trim();

  const result: ParsedCommand = {
    command: "",
    args: [],
    paths: [],
    hasRedirection: false,
    hasPipes: false,
      pipeCommands: [],
    variables: [],
    commandSubstitutions: [],
    dangerousPatterns: detectDangerousPatterns(command),
  };

  // Split by pipes
  const pipeParts = trimmed.split(/\s*\|\s*/);
  result.hasPipes = pipeParts.length > 1;
  result.pipeCommands = pipeParts.map((p) => p.trim().split(/\s+/)[0] ?? "");

  // Parse the first command (primary)
  const firstPart = pipeParts[0]?.trim() ?? "";
  const tokens = firstPart.split(/\s+/);
  result.command = tokens[0] ?? "";
  result.args = tokens;

  // Detect output redirection
  const redirectMatch = firstPart.match(/(>>?)\s*(\S+)/);
  if (redirectMatch) {
    result.hasRedirection = true;
    result.redirectTarget = redirectMatch[2];
    if (redirectMatch[2]) {
      result.paths.push(redirectMatch[2]);
    }
  }

  // Detect variable expansions
  const varMatches = firstPart.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g);
  for (const m of varMatches) {
    result.variables.push(m[0]);
  }

  // Detect command substitutions
  const cmdSubMatches = firstPart.matchAll(/\$\([^)]+\)/g);
  for (const m of cmdSubMatches) {
    result.commandSubstitutions.push(m[0]);
  }

  const backtickMatches = firstPart.matchAll(/`[^`]+`/g);
  for (const m of backtickMatches) {
    result.commandSubstitutions.push(m[0]);
  }

  // Extract file paths from arguments
  for (const arg of tokens.slice(1)) {
    if (
      (arg.includes("/") || arg.includes("\\") || (arg.includes(".") && !arg.startsWith("-"))) &&
      !arg.startsWith("$") &&
      !arg.startsWith("-")
    ) {
      result.paths.push(arg);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Check if a command contains output redirection (> or >>).
 */
export function hasOutputRedirection(command: string): boolean {
  return />\s*\S+/.test(command) && !/2\s*>/.test(command);
}

/**
 * Extract the command name (first token) from a shell command string.
 */
export function extractCommandName(command: string): string {
  const trimmed = command.trim();
  // Handle pipes: take the first command
  const firstPart = trimmed.split("|")[0]?.trim() ?? "";
  // Handle cd && cmd: take the command after &&
  const afterCd = firstPart.match(/(?:cd|set-location)\s+\S+\s*(?:&&|;)\s*(.+)/i);
  if (afterCd) {
    return afterCd[1]?.trim().split(/\s+/)[0] ?? "";
  }
  return firstPart.split(/\s+/)[0] ?? "";
}
