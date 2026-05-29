/**
 * Plugin System for Pakalon CLI
 * 
 * Provides a plugin architecture for extending CLI functionality through
 * custom commands, tools, hooks, and UI components.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  main: string;
  commands?: PluginCommand[];
  tools?: PluginTool[];
  hooks?: PluginHook[];
  permissions?: string[];
  dependencies?: Record<string, string>;
}

export interface PluginCommand {
  name: string;
  description: string;
  usage?: string;
  execute: (args: string[], context: PluginContext) => Promise<string>;
}

export interface PluginTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: PluginContext) => Promise<unknown>;
}

export interface PluginHook {
  event: string;
  handler: (payload: unknown, context: PluginContext) => Promise<void> | void;
}

export interface PluginContext {
  cwd: string;
  sessionId?: string;
  config: PluginConfig;
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface PluginConfig {
  pluginsDir: string;
  enabledPlugins: Set<string>;
  pluginSettings: Map<string, Record<string, unknown>>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: unknown;
  commands: Map<string, PluginCommand>;
  tools: Map<string, PluginTool>;
  hooks: Map<string, PluginHook[]>;
}

const PLUGIN_SCHEMA = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  main: z.string(),
  commands: z.array(z.object({
    name: z.string(),
    description: z.string(),
    usage: z.string().optional(),
  })).optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
  })).optional(),
  hooks: z.array(z.object({
    event: z.string(),
  })).optional(),
  permissions: z.array(z.string()).optional(),
  dependencies: z.record(z.string()).optional(),
});

class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private config: PluginConfig;
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || join(process.cwd(), ".pakalon", "plugins");
    this.config = {
      pluginsDir: this.pluginsDir,
      enabledPlugins: new Set(),
      pluginSettings: new Map(),
    };
  }

  async loadPlugin(pluginPath: string): Promise<LoadedPlugin | null> {
    try {
      const manifestPath = join(pluginPath, "package.json");
      if (!existsSync(manifestPath)) {
        logger.warn(`[PluginManager] No package.json found in ${pluginPath}`);
        return null;
      }

      const manifestRaw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw) as PluginManifest;

      // Validate manifest
      const validation = PLUGIN_SCHEMA.safeParse(manifest);
      if (!validation.success) {
        logger.error(`[PluginManager] Invalid plugin manifest:`, validation.error);
        return null;
      }

      // Load the plugin module
      const pluginModule = await import(pluginPath);

      const loaded: LoadedPlugin = {
        manifest,
        instance: pluginModule.default || pluginModule,
        commands: new Map(),
        tools: new Map(),
        hooks: new Map(),
      };

      // Register commands
      if (manifest.commands && pluginModule.commands) {
        for (const cmd of manifest.commands) {
          const handler = pluginModule.commands[cmd.name];
          if (typeof handler === "function") {
            loaded.commands.set(cmd.name, {
              ...cmd,
              execute: handler.bind(pluginModule),
            });
          }
        }
      }

      // Register tools
      if (manifest.tools && pluginModule.tools) {
        for (const tool of manifest.tools) {
          const handler = pluginModule.tools[tool.name];
          if (typeof handler === "function") {
            loaded.tools.set(tool.name, {
              ...tool,
              execute: handler.bind(pluginModule),
            });
          }
        }
      }

      // Register hooks
      if (manifest.hooks && pluginModule.hooks) {
        for (const hookDef of manifest.hooks) {
          const handler = pluginModule.hooks[hookDef.event];
          if (typeof handler === "function") {
            const hooks = loaded.hooks.get(hookDef.event) || [];
            hooks.push({
              event: hookDef.event,
              handler: handler.bind(pluginModule),
            });
            loaded.hooks.set(hookDef.event, hooks);
          }
        }
      }

      this.plugins.set(manifest.name, loaded);
      logger.info(`[PluginManager] Loaded plugin: ${manifest.name} v${manifest.version}`);

      return loaded;
    } catch (err) {
      logger.error(`[PluginManager] Failed to load plugin from ${pluginPath}:`, err);
      return null;
    }
  }

  async loadPlugins(): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      return;
    }

    try {
      const entries = readdirSync(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = join(this.pluginsDir, entry.name);
          await this.loadPlugin(pluginPath);
        }
      }
    } catch (err) {
      logger.error(`[PluginManager] Failed to load plugins:`, err);
    }
  }

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  getCommand(name: string): PluginCommand | undefined {
    for (const plugin of this.plugins.values()) {
      const cmd = plugin.commands.get(name);
      if (cmd) return cmd;
    }
    return undefined;
  }

  getTool(name: string): PluginTool | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.get(name);
      if (tool) return tool;
    }
    return undefined;
  }

  getHooksForEvent(event: string): Array<{ plugin: string; handler: PluginHook["handler"] }> {
    const result: Array<{ plugin: string; handler: PluginHook["handler"] }> = [];
    for (const [pluginName, plugin] of this.plugins.entries()) {
      const hooks = plugin.hooks.get(event);
      if (hooks) {
        for (const hook of hooks) {
          result.push({ plugin: pluginName, handler: hook.handler });
        }
      }
    }
    return result;
  }

  async executeHook(event: string, payload: unknown, context: PluginContext): Promise<void> {
    const hooks = this.getHooksForEvent(event);
    for (const { handler } of hooks) {
      try {
        await handler(payload, context);
      } catch (err) {
        logger.error(`[PluginManager] Hook ${event} failed:`, err);
      }
    }
  }

  unloadPlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    this.plugins.delete(name);
    logger.info(`[PluginManager] Unloaded plugin: ${name}`);
    return true;
  }

  getPluginDirectory(): string {
    return this.pluginsDir;
  }
}

let pluginManager: PluginManager | null = null;

export function getPluginManager(pluginsDir?: string): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager(pluginsDir);
  }
  return pluginManager;
}

export async function initializePlugins(pluginsDir?: string): Promise<void> {
  const manager = getPluginManager(pluginsDir);
  await manager.loadPlugins();
}

export async function installPlugin(name: string, source: string): Promise<boolean> {
  try {
    logger.info(`[PluginManager] Installing plugin ${name} from ${source}`);
    // In a full implementation, this would use npm or git to install
    return true;
  } catch (err) {
    logger.error(`[PluginManager] Failed to install plugin:`, err);
    return false;
  }
}

export async function uninstallPlugin(name: string): Promise<boolean> {
  return getPluginManager().unloadPlugin(name);
}

export default PluginManager;