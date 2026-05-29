/**
 * Tool Pool Assembly
 *
 * Utilities for building the complete tool pool from multiple sources and
 * filtering based on deny rules.
 *
 * The tool pool is the union of:
 *   1. Built-in tools (from ai/tools.ts)
 *   2. Registry tools (from tools/registry.ts)
 *   3. MCP tools (from connected MCP servers)
 *   4. Dynamic tools (skill tool, etc.)
 *
 * These are assembled into a Vercel AI SDK ToolSet that gets passed to
 * generateText() / streamText() as the `tools` option.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolDefinition } from "./executor.js";
import { getAllTools } from "./registry.js";
import type { ToolPermissionRulesBySource } from "./tool-types.js";
import { logForDebugging } from "@/utils/debug.js";

// ============================================================================
// buildTool — Convert ToolDefinition to Vercel AI SDK tool()
// ============================================================================

/**
 * Converts a local ToolDefinition to the Vercel AI SDK `tool()` format.
 *
 * @param toolDef The tool definition to convert
 * @returns A Vercel AI SDK tool object
 */
export function buildTool<T extends z.ZodSchema>(
  toolDef: ToolDefinition<T>,
): ReturnType<typeof tool> {
  const { name, description, parameters, execute, executeStream } = toolDef;

  return tool({
    description,
    parameters,
    execute: async (args: z.infer<T>, options?: { abortSignal?: AbortSignal }) => {
      if (executeStream) {
        // For streaming tools, collect chunks
        const chunks: string[] = [];
        await executeStream(args, (chunk: string) => {
          chunks.push(chunk);
        });
        return chunks.join("");
      }
      return await execute(args);
    },
  });
}

// ============================================================================
// assembleToolPool — Build Complete Tool Pool
// ============================================================================

/**
 * Options for assembling the tool pool.
 */
export interface ToolPoolOptions {
  /** Include registry tools? (default: true) */
  includeRegistry?: boolean;
  /** Include built-in tools? (default: true, these are from ai/tools.ts) */
  includeBuiltin?: boolean;
  /** Include MCP tools? (default: true) */
  includeMcp?: boolean;
  /** Include skill tool? (default: true) */
  includeSkillTool?: boolean;
  /** Deny rules to apply */
  denyRules?: string[];
  /** Custom tool overrides (allows adding extra tools to the pool) */
  customTools?: ToolSet;
  /** Tool set from built-in tools (ai/tools.ts allTools) */
  builtinTools?: ToolSet;
}

/**
 * Assembles the complete tool pool from all available sources.
 * This is the central function that decides which tools the model can call.
 *
 * @param options Configuration for tool pool assembly
 * @returns The assembled ToolSet
 */
export function assembleToolPool(options: ToolPoolOptions = {}): ToolSet {
  const {
    includeRegistry = true,
    includeBuiltin = true,
    includeMcp = true,
    includeSkillTool = true,
    denyRules,
    customTools,
    builtinTools,
  } = options;

  let pool: ToolSet = {};

  // 1. Add built-in tools (the main toolset from ai/tools.ts)
  if (includeBuiltin && builtinTools) {
    pool = { ...pool, ...builtinTools };
  }

  // 2. Add registry tools (registered via tools/registry.ts)
  if (includeRegistry) {
    const registryTools = getAllTools();
    for (const [name, toolDef] of registryTools) {
      // Don't override built-in tools
      if (!pool[name]) {
        pool[name] = buildTool(toolDef);
      }
    }
  }

  // 3. Add MCP tools (reserved for MCP integration)
  if (includeMcp) {
    // MCP tools are added dynamically by the MCP client manager
    // This hook is for future MCP tool merging
  }

  // 4. Add custom tool overrides
  if (customTools) {
    pool = { ...pool, ...customTools };
  }

  // 5. Apply deny rules (filter out denied tools)
  if (denyRules && denyRules.length > 0) {
    pool = filterToolsByDenyRules(pool, denyRules);
  }

  // Sort tool order stably by name for consistent prompt caching.
  // Tool order affects prompt cache hit rate, so keep this deterministic.
  const sortedEntries = Object.entries(pool).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  return Object.fromEntries(sortedEntries) as ToolSet;
}

// ============================================================================
// filterToolsByDenyRules — Filter Tool Pool
// ============================================================================

/**
 * Filters a ToolSet by removing tools matching deny rules.
 *
 * Deny rules can be:
 *   - Exact tool names: e.g., "bash", "writeFile"
 *   - Wildcard patterns: e.g., "lsp_*", "browser_*"
 *   - Category prefixes: e.g., "lsp" removes all lsp* tools
 *
 * @param tools The tool pool to filter
 * @param denyRules Array of deny rules (tool names or wildcards)
 * @returns The filtered tool pool
 */
export function filterToolsByDenyRules(
  tools: ToolSet,
  denyRules: string[],
): ToolSet {
  if (!denyRules || denyRules.length === 0) {
    return { ...tools };
  }

  const filtered: ToolSet = {};
  const deniedNames = new Set<string>();

  // Pre-process deny rules to expand wildcards
  for (const rule of denyRules) {
    const trimmed = rule.trim();
    if (!trimmed) continue;

    if (trimmed.endsWith("*")) {
      // Wildcard rule — mark all matching tool names for removal
      const prefix = trimmed.slice(0, -1);
      for (const toolName of Object.keys(tools)) {
        if (toolName.startsWith(prefix)) {
          deniedNames.add(toolName);
        }
      }
    } else {
      // Exact match rule
      deniedNames.add(trimmed);
    }
  }

  // Build filtered pool
  for (const [name, toolDef] of Object.entries(tools)) {
    if (!deniedNames.has(name)) {
      filtered[name] = toolDef;
    }
  }

  const removedCount = Object.keys(tools).length - Object.keys(filtered).length;
  if (removedCount > 0) {
    logForDebugging(
      `[toolPool] Filtered ${removedCount} tools by deny rules: ${[...deniedNames].join(", ")}`,
    );
  }

  return filtered;
}

// ============================================================================
// Tool Permission Context Helpers
// ============================================================================

/**
 * Resolves tool-level deny rules from a ToolPermissionRulesBySource object.
 * Merges rules from all sources (cliArg, session, frontmatter, plugin).
 *
 * @param rulesBySource The permission rules grouped by source
 * @returns A flat deduplicated array of tool names to deny
 */
export function resolveToolDenyRules(
  rulesBySource: ToolPermissionRulesBySource | undefined,
): string[] {
  if (!rulesBySource) return [];

  const denied = new Set<string>();

  for (const source of ["cliArg", "session", "frontmatter", "plugin"] as const) {
    const rules = rulesBySource[source];
    if (rules && Array.isArray(rules)) {
      for (const rule of rules) {
        denied.add(rule);
      }
    }
  }

  return [...denied];
}
