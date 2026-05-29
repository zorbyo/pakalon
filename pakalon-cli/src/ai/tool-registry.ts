/**
 * Tool Registry System - Copilot CLI Style
 * 
 * Manages all available tools for the agent runtime.
 * Provides tool registration, discovery, and execution.
 * 
 * Replaces mixed Python/TypeScript tool system with pure TypeScript.
 */

import { z } from 'zod';
import type { CoreTool } from 'ai';

/**
 * Tool handler function type
 */
export type ToolHandler<TArgs = any, TResult = any> = (
  args: TArgs
) => Promise<TResult>;

/**
 * Tool definition with handler
 */
export interface Tool {
  definition: CoreTool;
  handler: ToolHandler;
  category?: string;
  dangerous?: boolean;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  output?: any;
  error?: string;
  duration?: number;
}

/**
 * Tool call structure
 */
export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: any;
}

/**
 * Tool Registry - Central registry for all agent tools
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private categories = new Map<string, Set<string>>();

  constructor() {
    // Tools will be registered by importers
  }

  /**
   * Register a tool
   */
  register(
    name: string,
    definition: CoreTool,
    handler: ToolHandler,
    options?: {
      category?: string;
      dangerous?: boolean;
    }
  ): void {
    this.tools.set(name, {
      definition,
      handler,
      category: options?.category,
      dangerous: options?.dangerous || false,
    });

    // Track by category
    if (options?.category) {
      if (!this.categories.has(options.category)) {
        this.categories.set(options.category, new Set());
      }
      this.categories.get(options.category)!.add(name);
    }
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool && tool.category) {
      this.categories.get(tool.category)?.delete(name);
    }
    return this.tools.delete(name);
  }

  /**
   * Execute a tool
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(toolCall.toolName);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolCall.toolName}`,
        duration: Date.now() - startTime,
      };
    }

    try {
      const result = await tool.handler(toolCall.args);
      return {
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get tool definitions for LLM (Vercel AI SDK format)
   */
  getToolDefinitions(): Record<string, CoreTool> {
    const definitions: Record<string, CoreTool> = {};
    this.tools.forEach((tool, name) => {
      definitions[name] = tool.definition;
    });
    return definitions;
  }

  /**
   * Get filtered tool definitions
   */
  getFilteredDefinitions(options: {
    allowed?: string[];
    denied?: string[];
    categories?: string[];
  }): Record<string, CoreTool> {
    const definitions: Record<string, CoreTool> = {};

    this.tools.forEach((tool, name) => {
      // Check denied list first
      if (options.denied?.includes(name)) {
        return;
      }

      // Check allowed list
      if (options.allowed && !options.allowed.includes(name)) {
        return;
      }

      // Check categories
      if (options.categories && tool.category) {
        if (!options.categories.includes(tool.category)) {
          return;
        }
      }

      definitions[name] = tool.definition;
    });

    return definitions;
  }

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool info
   */
  getToolInfo(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tool names
   */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * List tools by category
   */
  listToolsByCategory(category: string): string[] {
    return Array.from(this.categories.get(category) || []);
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  /**
   * Check if tool is dangerous
   */
  isDangerous(name: string): boolean {
    return this.tools.get(name)?.dangerous || false;
  }

  /**
   * Get tool statistics
   */
  getStats() {
    return {
      totalTools: this.tools.size,
      categories: this.categories.size,
      dangerousTools: Array.from(this.tools.values()).filter(
        (t) => t.dangerous
      ).length,
      toolsByCategory: Object.fromEntries(
        Array.from(this.categories.entries()).map(([cat, tools]) => [
          cat,
          tools.size,
        ])
      ),
    };
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.categories.clear();
  }
  
  /**
   * Singleton instance
   */
  private static instance: ToolRegistry | null = null;
  
  /**
   * Get singleton instance with default tools registered
   */
  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
      ToolRegistry.instance.initializeDefaultTools();
    }
    return ToolRegistry.instance;
  }
  
  /**
   * Initialize default Copilot CLI-style tools
   */
  private initializeDefaultTools(): void {
    // Dynamically import and register tools to avoid circular dependencies
    // Tools will auto-register when imported
    
    // web_fetch tool
    import('@/tools/web-fetch').then(mod => {
      const tool = mod.default;
      if (tool && !this.hasTool(tool.name)) {
        this.register(
          tool.name,
          { description: tool.definition.description, parameters: tool.definition.parameters },
          tool.handler,
          { category: tool.category, dangerous: tool.isDangerous }
        );
      }
    }).catch(() => {});
    
    // task and fleet delegation tools
    import('@/tools/task-fleet').then(mod => {
      const { taskTool, fleetTool } = mod;
      if (taskTool && !this.hasTool(taskTool.name)) {
        this.register(
          taskTool.name,
          { description: taskTool.definition.description, parameters: taskTool.definition.parameters },
          taskTool.handler,
          { category: taskTool.category, dangerous: taskTool.isDangerous }
        );
      }
      if (fleetTool && !this.hasTool(fleetTool.name)) {
        this.register(
          fleetTool.name,
          { description: fleetTool.definition.description, parameters: fleetTool.definition.parameters },
          fleetTool.handler,
          { category: fleetTool.category, dangerous: fleetTool.isDangerous }
        );
      }
    }).catch(() => {});
  }
}

/**
 * Global tool registry instance (legacy - use ToolRegistry.getInstance() instead)
 */
export const globalToolRegistry = new ToolRegistry();

/**
 * Helper to create a tool definition
 */
export function createToolDefinition(config: {
  description: string;
  parameters: z.ZodType<any>;
  execute?: ToolHandler;
}): CoreTool {
  return {
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
  };
}

/**
 * Decorator for registering tools
 */
export function registerTool(
  name: string,
  definition: CoreTool,
  options?: { category?: string; dangerous?: boolean }
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    globalToolRegistry.register(name, definition, descriptor.value, options);
    return descriptor;
  };
}
