/**
 * Plugin Hook Loader + Frontmatter Hook Registration.
 *
 * Implements Claude Code-style plugin hook loading and frontmatter hook registration:
 * - Plugin hook loading: Discover and register hooks from installed plugins
 * - Frontmatter hook registration: Parse skill/template frontmatter for hook definitions
 * - Permission hook integration: Bridge between permission system and hooks
 *
 * Usage:
 *   const loader = new PluginHookLoader();
 *   await loader.loadPluginHooks();
 *   const hooks = loader.getRegisteredHooks();
 *
 *   // Frontmatter registration
 *   registerFrontmatterHooks(skillFrontmatter);
 *
 *   // Permission integration
 *   integrateHooksWithPermissions(permissionRules, hooks);
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";
import type {
  HookEvent,
  HookDefinition,
  HooksConfig,
} from "@/ai/hooks.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  hooks?: Partial<Record<HookEvent, HookDefinition[]>>;
  permissions?: Array<{
    tool: string;
    action: "allow" | "deny" | "ask";
    pattern?: string;
  }>;
}

export interface RegisteredHook {
  id: string;
  source: "plugin" | "frontmatter" | "skill";
  sourceName: string;
  event: HookEvent;
  definition: HookDefinition;
  registeredAt: Date;
}

export interface FrontmatterHookConfig {
  /** Hook event type */
  event: HookEvent;
  /** Shell command to run */
  command: string;
  /** Glob pattern for file matching */
  match?: string;
  /** Whether failure blocks execution */
  blockOnFail?: boolean;
  /** Whether to run async */
  async?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Hook Loader
// ─────────────────────────────────────────────────────────────────────────────

export class PluginHookLoader {
  private registeredHooks: RegisteredHook[] = [];
  private pluginDir: string;

  constructor(pluginDir?: string) {
    this.pluginDir =
      pluginDir ??
      path.join(
        process.env.HOME || process.env.USERPROFILE || "~",
        ".config",
        "pakalon",
        "plugins",
      );
  }

  /**
   * Discover and load hooks from all installed plugins.
   */
  async loadPluginHooks(): Promise<RegisteredHook[]> {
    const hooks: RegisteredHook[] = [];

    try {
      if (!fs.existsSync(this.pluginDir)) {
        logger.debug("[PluginHooks] No plugin directory", { dir: this.pluginDir });
        return hooks;
      }

      const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(this.pluginDir, entry.name);
        const manifestPath = path.join(pluginPath, "package.json");

        if (!fs.existsSync(manifestPath)) continue;

        try {
          const manifest: PluginManifest = JSON.parse(
            fs.readFileSync(manifestPath, "utf-8"),
          );

          if (!manifest.hooks) continue;

          for (const [event, definitions] of Object.entries(manifest.hooks)) {
            if (!definitions) continue;

            for (const def of definitions) {
              const hook: RegisteredHook = {
                id: crypto.randomUUID(),
                source: "plugin",
                sourceName: manifest.name,
                event: event as HookEvent,
                definition: {
                  ...def,
                  command: this.resolveCommandPath(def.command ?? "", pluginPath),
                },
                registeredAt: new Date(),
              };
              hooks.push(hook);
              this.registeredHooks.push(hook);
            }
          }

          logger.debug("[PluginHooks] Loaded plugin hooks", {
            plugin: manifest.name,
            hookCount: Object.keys(manifest.hooks).length,
          });
        } catch (err) {
          logger.warn("[PluginHooks] Failed to load plugin", {
            plugin: entry.name,
            error: String(err),
          });
        }
      }
    } catch (err) {
      logger.warn("[PluginHooks] Failed to scan plugin directory", {
        error: String(err),
      });
    }

    this.registeredHooks = hooks;
    logger.info("[PluginHooks] Loaded hooks", { count: hooks.length });
    return hooks;
  }

  /**
   * Register hooks from a plugin manifest.
   */
  registerPluginHooks(manifest: PluginManifest): RegisteredHook[] {
    const hooks: RegisteredHook[] = [];

    if (!manifest.hooks) return hooks;

    for (const [event, definitions] of Object.entries(manifest.hooks)) {
      if (!definitions) continue;

      for (const def of definitions) {
        const hook: RegisteredHook = {
          id: crypto.randomUUID(),
          source: "plugin",
          sourceName: manifest.name,
          event: event as HookEvent,
          definition: def,
          registeredAt: new Date(),
        };
        hooks.push(hook);
        this.registeredHooks.push(hook);
      }
    }

    logger.debug("[PluginHooks] Registered plugin hooks", {
      plugin: manifest.name,
      count: hooks.length,
    });

    return hooks;
  }

  /**
   * Get all registered hooks.
   */
  getRegisteredHooks(): RegisteredHook[] {
    return [...this.registeredHooks];
  }

  /**
   * Get hooks for a specific event.
   */
  getHooksByEvent(event: HookEvent): RegisteredHook[] {
    return this.registeredHooks.filter((h) => h.event === event);
  }

  /**
   * Get hooks by source type.
   */
  getHooksBySource(source: RegisteredHook["source"]): RegisteredHook[] {
    return this.registeredHooks.filter((h) => h.source === source);
  }

  /**
   * Remove all hooks from a specific plugin.
   */
  removePluginHooks(pluginName: string): number {
    const before = this.registeredHooks.length;
    this.registeredHooks = this.registeredHooks.filter(
      (h) => !(h.source === "plugin" && h.sourceName === pluginName),
    );
    return before - this.registeredHooks.length;
  }

  /**
   * Clear all registered hooks.
   */
  clear(): void {
    this.registeredHooks = [];
  }

  /**
   * Resolve a command path relative to the plugin directory.
   */
  private resolveCommandPath(command: string, pluginPath: string): string {
    // If the command starts with ./ or ../, resolve relative to plugin path
    if (command.startsWith("./") || command.startsWith("../")) {
      return path.resolve(pluginPath, command);
    }
    return command;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter Hook Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse hooks from skill/template frontmatter.
 *
 * Expected format in SKILL.md frontmatter:
 * ```yaml
 * hooks:
 *   - PreToolUse:
 *       match: "bash"
 *       command: "./hooks/pre-bash.sh"
 *       blockOnFail: true
 *   - PostToolUse:
 *       command: "./hooks/post-tool.sh"
 * ```
 */
export function parseFrontmatterHooks(
  frontmatter: Record<string, unknown>,
): FrontmatterHookConfig[] {
  const hooks: FrontmatterHookConfig[] = [];
  const rawHooks = frontmatter.hooks;

  if (!Array.isArray(rawHooks)) return hooks;

  for (const entry of rawHooks) {
    if (typeof entry !== "object" || entry === null) continue;

    for (const [event, config] of Object.entries(entry)) {
      if (typeof config !== "object" || config === null) continue;

      const cfg = config as Record<string, unknown>;
      hooks.push({
        event: event as HookEvent,
        command: String(cfg.command ?? ""),
        match: cfg.match ? String(cfg.match) : undefined,
        blockOnFail: cfg.blockOnFail === true,
        async: cfg.async === true,
      });
    }
  }

  return hooks;
}

/**
 * Register hooks parsed from frontmatter into a hooks config.
 */
export function registerFrontmatterHooks(
  hooksConfig: HooksConfig,
  frontmatterHooks: FrontmatterHookConfig[],
  sourceName: string,
): RegisteredHook[] {
  const registered: RegisteredHook[] = [];

  for (const fh of frontmatterHooks) {
    const event = fh.event;
    const def: HookDefinition = {
      type: "command",
      command: fh.command,
      match: fh.match,
      blockOnFail: fh.blockOnFail,
      async: fh.async,
    };

    // Add to config
    if (!hooksConfig[event]) hooksConfig[event] = [];
    hooksConfig[event]!.push(def);

    registered.push({
      id: crypto.randomUUID(),
      source: "frontmatter",
      sourceName,
      event,
      definition: def,
      registeredAt: new Date(),
    });
  }

  return registered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission Hook Integration
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionHookRequest {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface PermissionHookDecision {
  action: "allow" | "deny" | "ask";
  reason?: string;
}

/**
 * Bridge between permission system and hooks.
 * Checks registered hooks for any that can decide on tool permissions.
 */
export function evaluatePermissionHooks(
  request: PermissionHookRequest,
  registeredHooks: RegisteredHook[],
): PermissionHookDecision | null {
  // Find hooks registered for PermissionRequest event
  const permissionHooks = registeredHooks.filter(
    (h) => h.event === "PermissionRequest",
  );

  for (const hook of permissionHooks) {
    const def = hook.definition;

    // Check if hook matches this tool
    if (def.match && request.toolName) {
      const pattern = new RegExp(
        def.match.replace(/\*/g, ".*"),
        "i",
      );
      if (!pattern.test(request.toolName)) continue;
    }

    // If hook matches, its decision takes precedence
    // (In production, this would execute the hook script and parse output)
    return {
      action: "ask",
      reason: `Hook ${hook.sourceName} needs to evaluate permissions`,
    };
  }

  return null;
}

/**
 * Integrate permission rules with registered hooks.
 * Returns flattened list of allow/deny/ask rules derived from hooks.
 */
export function integrateHooksWithPermissions(
  registeredHooks: RegisteredHook[],
): Array<{
  tool: string;
  action: "allow" | "deny" | "ask";
  pattern?: string;
  source: string;
}> {
  const rules: Array<{
    tool: string;
    action: "allow" | "deny" | "ask";
    pattern?: string;
    source: string;
  }> = [];

  for (const hook of registeredHooks) {
    if (hook.event === "PreToolUse" && hook.definition.match) {
      rules.push({
        tool: hook.definition.match,
        action: "ask",
        pattern: undefined,
        source: `${hook.source}:${hook.sourceName}`,
      });
    }
  }

  return rules;
}
