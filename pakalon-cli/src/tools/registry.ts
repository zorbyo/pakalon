import { z } from "zod";
import type { ToolDefinition } from "./executor.js";
import logger from "@/utils/logger.js";

const toolRegistry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  if (toolRegistry.has(tool.name)) {
    logger.warn(`[tools/registry] Tool "${tool.name}" already registered, overwriting`);
  }
  toolRegistry.set(tool.name, tool);
  logger.debug(`[tools/registry] Registered tool: ${tool.name}`);
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name);
}

export function getAllTools(): Map<string, ToolDefinition> {
  return new Map(toolRegistry);
}

export function getToolNames(): string[] {
  return Array.from(toolRegistry.keys());
}

export function getToolsByCategory(category: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const tool of toolRegistry.values()) {
    if (tool.name.startsWith(`${category}_`) || tool.name === category) {
      tools.push(tool);
    }
  }
  return tools;
}

export function unregisterTool(name: string): boolean {
  const deleted = toolRegistry.delete(name);
  if (deleted) {
    logger.debug(`[tools/registry] Unregistered tool: ${name}`);
  }
  return deleted;
}

export function clearRegistry(): void {
  toolRegistry.clear();
  logger.debug("[tools/registry] Cleared all tools");
}

export function getToolMetadata(name: string) {
  const tool = toolRegistry.get(name);
  if (!tool) return null;

  return {
    name: tool.name,
    description: tool.description,
    requiresPermission: tool.requiresPermission ?? false,
    hasStreaming: !!tool.executeStream,
  };
}

export type { ToolDefinition };
