/**
 * Comprehensive Tool Registry - Auto-registers all available tools
 * Combines file-ops, git-ops, bash, ripgrep, and other tools
 */
import { fileOpsTools } from './file-ops.js';
import { gitOpsTools } from './git-ops.js';
import type { ToolDefinition } from './executor.js';
import logger from '@/utils/logger.js';
import { allTools } from '@/ai/tools.js';
import { tool, type ToolSet } from 'ai';

// ---------------------------------------------------------------------------
// Tool Registry Map
// ---------------------------------------------------------------------------

const toolRegistry = new Map<string, ToolDefinition>();

// ---------------------------------------------------------------------------
// Auto-register all tools
// ---------------------------------------------------------------------------

/**
 * Register file operations tools
 */
export function registerFileOpsTools() {
  Object.entries(fileOpsTools).forEach(([name, tool]) => {
    registerTool(tool as ToolDefinition);
  });
  logger.info(`[registry] Registered ${Object.keys(fileOpsTools).length} file operation tools`);
}

/**
 * Register git operations tools
 */
export function registerGitOpsTools() {
  Object.entries(gitOpsTools).forEach(([name, tool]) => {
    registerTool(tool as ToolDefinition);
  });
  logger.info(`[registry] Registered ${Object.keys(gitOpsTools).length} git operation tools`);
}

/**
 * Register bash tool
 */
export function registerBashTool() {
  // The bash tool from bash.ts needs to be wrapped in ToolDefinition format
  // For now, we'll register it separately when bash.ts is updated
  logger.info('[registry] Bash tool registration pending');
}

/**
 * Initialize all tools at startup
 */
export function initializeToolRegistry() {
  logger.info('[registry] Initializing tool registry...');
  
  registerFileOpsTools();
  registerGitOpsTools();
  // registerBashTool(); // TODO: Update bash.ts to match ToolDefinition interface
  
  logger.info(`[registry] Total tools registered: ${toolRegistry.size}`);
}

// ---------------------------------------------------------------------------
// Registry Management Functions
// ---------------------------------------------------------------------------

export function registerTool(tool: ToolDefinition): void {
  if (toolRegistry.has(tool.name)) {
    logger.warn(`[registry] Tool "${tool.name}" already registered, overwriting`);
  }
  toolRegistry.set(tool.name, tool);
  logger.debug(`[registry] Registered tool: ${tool.name}`);
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
    logger.debug(`[registry] Unregistered tool: ${name}`);
  }
  return deleted;
}

export function clearRegistry(): void {
  toolRegistry.clear();
  logger.debug('[registry] Cleared all tools');
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

// ---------------------------------------------------------------------------
// Export convenience object for Vercel AI SDK
// ---------------------------------------------------------------------------

/**
 * Get all tools as an object (for Vercel AI SDK)
 */
export function getToolsForAI(): ToolSet {
  const tools: ToolSet = { ...allTools };

  for (const [name, legacyTool] of toolRegistry.entries()) {
    if (tools[name]) continue;
    tools[name] = tool({
      description: legacyTool.description,
      inputSchema: legacyTool.parameters,
      execute: legacyTool.execute as never,
    });
  }

  return tools;
}

/**
 * Get tool schemas for LLM (Vercel AI SDK format)
 */
export function getToolSchemas() {
  const schemas: any[] = [];
  
  for (const tool of toolRegistry.values()) {
    schemas.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }
  
  return schemas;
}

// ---------------------------------------------------------------------------
// Export types
// ---------------------------------------------------------------------------

export type { ToolDefinition };

// ---------------------------------------------------------------------------
// Auto-initialize on import
// ---------------------------------------------------------------------------

// Initialize registry when module is imported
initializeToolRegistry();
