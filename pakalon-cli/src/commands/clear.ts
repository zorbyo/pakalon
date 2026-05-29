/**
 * Clear Command for Pakalon CLI
 * 
 * Clears conversation history and session caches.
 */

import type { CommandContext, CommandResult } from "./types.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClearOptions {
  /** Clear conversation history */
  conversation?: boolean;
  /** Clear all caches */
  caches?: boolean;
  /** Clear specific cache types */
  cacheTypes?: CacheType[];
  /** Preserve certain agent IDs */
  preserveAgentIds?: string[];
}

export type CacheType =
  | "context"
  | "skills"
  | "commands"
  | "files"
  | "git"
  | "mcp"
  | "search"
  | "prompts"
  | "tools"
  | "all";

// ---------------------------------------------------------------------------
// Cache Registry
// ---------------------------------------------------------------------------

interface CacheEntry {
  name: string;
  type: CacheType;
  clear: () => void | Promise<void>;
}

const cacheRegistry: Map<string, CacheEntry> = new Map();

export function registerCache(
  id: string,
  name: string,
  type: CacheType,
  clear: () => void | Promise<void>
): void {
  cacheRegistry.set(id, { name, type, clear });
}

export function unregisterCache(id: string): void {
  cacheRegistry.delete(id);
}

// ---------------------------------------------------------------------------
// Built-in Cache Entries
// ---------------------------------------------------------------------------

// Session context cache
const sessionContextCache: Map<string, unknown> = new Map();
registerCache("session-context", "Session Context", "context", () => {
  sessionContextCache.clear();
});

// Git status cache
const gitStatusCache: Map<string, unknown> = new Map();
registerCache("git-status", "Git Status", "git", () => {
  gitStatusCache.clear();
});

// File suggestions cache
const fileSuggestionsCache: Map<string, string[]> = new Map();
registerCache("file-suggestions", "File Suggestions", "files", () => {
  fileSuggestionsCache.clear();
});

// Search results cache
const searchResultsCache: Map<string, unknown> = new Map();
registerCache("search-results", "Search Results", "search", () => {
  searchResultsCache.clear();
});

// Tool definitions cache
const toolDefinitionsCache: Map<string, unknown> = new Map();
registerCache("tool-definitions", "Tool Definitions", "tools", () => {
  toolDefinitionsCache.clear();
});

// Prompt templates cache
const promptTemplatesCache: Map<string, string> = new Map();
registerCache("prompt-templates", "Prompt Templates", "prompts", () => {
  promptTemplatesCache.clear();
});

// ---------------------------------------------------------------------------
// Clear Functions
// ---------------------------------------------------------------------------

/**
 * Clear conversation history
 */
export async function clearConversation(context: CommandContext): Promise<void> {
  if (context.messages) {
    context.messages.length = 0;
  }
  
  // Clear any turn-specific state
  sessionContextCache.delete("current-turn");
  sessionContextCache.delete("last-response");
  
  logger.info("[clear] Conversation cleared");
}

/**
 * Clear specific cache types
 */
export async function clearCaches(
  types: CacheType[] = ["all"],
  preserveAgentIds?: Set<string>
): Promise<{ cleared: string[]; errors: string[] }> {
  const cleared: string[] = [];
  const errors: string[] = [];

  const shouldClear = (entry: CacheEntry): boolean => {
    if (types.includes("all")) return true;
    return types.includes(entry.type);
  };

  for (const [id, entry] of cacheRegistry.entries()) {
    if (!shouldClear(entry)) continue;

    // Skip agent-related caches if preserving
    if (preserveAgentIds?.size && id.startsWith("agent-")) {
      const agentId = id.replace("agent-", "");
      if (preserveAgentIds.has(agentId)) {
        continue;
      }
    }

    try {
      await entry.clear();
      cleared.push(entry.name);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${entry.name}: ${msg}`);
      logger.error(`[clear] Error clearing ${entry.name}: ${msg}`);
    }
  }

  logger.info(`[clear] Cleared ${cleared.length} caches`);
  return { cleared, errors };
}

/**
 * Clear all session state
 */
export async function clearSessionCaches(
  preserveAgentIds?: Set<string>
): Promise<void> {
  // Clear all registered caches
  await clearCaches(["all"], preserveAgentIds);

  // Additional cleanup for any module-level state
  sessionContextCache.clear();
  gitStatusCache.clear();
  fileSuggestionsCache.clear();
  searchResultsCache.clear();
  toolDefinitionsCache.clear();
  promptTemplatesCache.clear();

  logger.info("[clear] All session caches cleared");
}

// ---------------------------------------------------------------------------
// Command Implementation
// ---------------------------------------------------------------------------

export const clearCommand = {
  name: "clear",
  aliases: ["cls"],
  description: "Clear conversation history and/or session caches",
  usage: "/clear [caches|conversation|all]",
  
  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const arg = args[0]?.toLowerCase() ?? "all";
    
    let message: string;
    
    switch (arg) {
      case "caches":
      case "cache":
        const { cleared, errors } = await clearCaches(["all"]);
        message = `Cleared ${cleared.length} cache(s)`;
        if (errors.length > 0) {
          message += `\nErrors: ${errors.join(", ")}`;
        }
        break;
        
      case "conversation":
      case "conv":
      case "chat":
        await clearConversation(context);
        message = "Conversation cleared";
        break;
        
      case "all":
      default:
        await clearConversation(context);
        await clearSessionCaches();
        message = "Conversation and caches cleared";
        break;
    }

    return {
      success: true,
      message,
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  clearCommand,
  clearConversation,
  clearCaches,
  clearSessionCaches,
  registerCache,
  unregisterCache,
  // Expose caches for external registration
  sessionContextCache,
  gitStatusCache,
  fileSuggestionsCache,
  searchResultsCache,
  toolDefinitionsCache,
  promptTemplatesCache,
};
