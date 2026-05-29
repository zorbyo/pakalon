/**
 * HarnessEngine → Vercel AI SDK ToolSet Adapter
 *
 * Converts ToolDefinition instances from the HarnessEngine tool pool
 * into the Vercel AI SDK tool() format so they can be used with
 * streamText(), runProxyToolLoop(), etc.
 *
 * This bridges the gap between the enhanced Tool system (with full
 * lifecycle, permissions, rendering) and the Vercel AI SDK runtime
 * that AgentScreen uses.
 */

import { tool } from "ai";
import type { ToolSet } from "ai";
import type { ToolDefinition } from "../tools/executor.js";

/**
 * Convert an array of ToolDefinitions into a Vercel AI SDK ToolSet.
 */
export function toolDefinitionsToToolSet(toolDefs: ToolDefinition[]): ToolSet {
  const result: ToolSet = {};
  for (const td of toolDefs) {
    // AI SDK v6 uses inputSchema, not parameters
    result[td.name] = tool({
      description: td.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: td.parameters as any,
      execute: async (args: unknown) => {
        return td.execute(args);
      },
    });
  }
  return result;
}

/**
 * Get a Vercel AI SDK ToolSet from the global HarnessEngine's tool pool.
 * Returns an empty object if the engine hasn't been initialized yet.
 */
export function getEngineToolSetSync(engine: {
  buildToolPool: () => { primary: ToolDefinition[]; restricted: ToolDefinition[]; blocked: ToolDefinition[] };
}): ToolSet {
  const pool = engine.buildToolPool();
  return toolDefinitionsToToolSet(pool.primary);
}

/**
 * Inject skill commands from the engine into a base system prompt.
 * Returns the system prompt with skill context appended.
 */
export function injectSkillsIntoPrompt(
  systemPrompt: string,
  skills: { name: string; description?: string; whenToUse?: string; content?: string }[],
): string {
  if (!skills || skills.length === 0) return systemPrompt;

  const skillBlocks = skills.map((s) => {
    const parts = [`### /${s.name}`];
    if (s.description) parts.push(`Description: ${s.description}`);
    if (s.whenToUse) parts.push(`When to use: ${s.whenToUse}`);
    if (s.content) parts.push(s.content);
    return parts.join("\n");
  });

  return `${systemPrompt}\n\n## Available Skills\n\n${skillBlocks.join("\n---\n")}\n`;
}
