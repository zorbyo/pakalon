/**
 * Hook Config Manager — JSON-based hook configuration.
 *
 * Provides hook configuration management:
 * - Load hooks from JSON files
 * - Validate hook configurations
 * - Hot-reload on file changes
 * - Hook scope management
 * - Frontmatter hook registration
 * - Skill hook registration
 *
 * Port from Claude Code's hook configuration patterns.
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type HookEventName =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "PreCompact"
  | "PostCompact"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "UserPromptSubmit"
  | "PreSampling"
  | "PostSampling"
  | "SubagentStart"
  | "SubagentEnd"
  | "BeforeProviderRequest"
  | "AfterProviderResponse"
  | "SavePoint"
  | "Abort"
  | "Settled"
  | "QueueUpdate"
  | "ModelSelect"
  | "ResourcesUpdate"
  | "SystemPromptBuild"
  | "ContextTransform";

export interface HookConfigEntry {
  /** Hook ID */
  id: string;
  /** Hook type */
  type: "command" | "function";
  /** Command to execute (for command type) */
  command?: string;
  /** Function reference (for function type) */
  function?: string;
  /** Timeout in seconds */
  timeout?: number;
  /** Whether hook is async */
  async?: boolean;
  /** Hook description */
  description?: string;
}

export interface HookMatcherConfig {
  /** Event name */
  event: HookEventName;
  /** Matchers for tool/input patterns */
  matchers: Array<string | { tool?: string | string[]; tool_input?: Record<string, unknown> }>;
  /** Hooks to execute */
  hooks: HookConfigEntry[];
  /** Matcher description */
  description?: string;
}

export interface HookConfigFile {
  /** Hook profile */
  profile?: "minimal" | "standard" | "strict";
  /** Disabled hook IDs */
  disabled_hooks?: string[];
  /** Hook matchers by event */
  hooks: {
    [event: string]: HookMatcherConfig[];
  };
}

export interface HookConfigValidation {
  /** Whether config is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Number of hooks loaded */
  hookCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Config Manager
// ─────────────────────────────────────────────────────────────────────────────

export class HookConfigManager {
  private config: HookConfigFile | null = null;
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;
  private changeListeners: Array<(config: HookConfigFile) => void> = [];

  constructor(configDir?: string) {
    this.configPath = path.join(
      configDir ?? process.env.PAKALON_CONFIG_DIR ?? path.join(
        process.env.HOME || process.env.USERPROFILE || "",
        ".config",
        "pakalon"
      ),
      "hooks.json"
    );
  }

  /**
   * Load hook configuration from file.
   */
  load(): HookConfigFile | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        logger.debug("[HookConfig] No config file found", { path: this.configPath });
        return null;
      }

      const raw = fs.readFileSync(this.configPath, "utf-8");
      const config = JSON.parse(raw) as HookConfigFile;

      // Validate config
      const validation = this.validate(config);
      if (!validation.valid) {
        logger.warn("[HookConfig] Invalid config", { errors: validation.errors });
      }

      this.config = config;
      logger.info("[HookConfig] Loaded config", {
        hookCount: validation.hookCount,
        profile: config.profile,
      });

      return config;
    } catch (error) {
      logger.error("[HookConfig] Failed to load config", { error: String(error) });
      return null;
    }
  }

  /**
   * Save hook configuration to file.
   */
  save(config: HookConfigFile): boolean {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");
      this.config = config;

      logger.debug("[HookConfig] Saved config", { path: this.configPath });
      return true;
    } catch (error) {
      logger.error("[HookConfig] Failed to save config", { error: String(error) });
      return false;
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): HookConfigFile | null {
    return this.config;
  }

  /**
   * Validate a hook configuration.
   */
  validate(config: HookConfigFile): HookConfigValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    let hookCount = 0;

    // Validate profile
    if (config.profile && !["minimal", "standard", "strict"].includes(config.profile)) {
      errors.push(`Invalid profile: ${config.profile}`);
    }

    // Validate disabled hooks
    if (config.disabled_hooks && !Array.isArray(config.disabled_hooks)) {
      errors.push("disabled_hooks must be an array");
    }

    // Validate hooks
    if (config.hooks) {
      for (const [event, matchers] of Object.entries(config.hooks)) {
        // Validate event name
        const validEvents = [
          "PreToolUse", "PostToolUse", "PostToolUseFailure",
          "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "Stop",
          "UserPromptSubmit", "PreSampling", "PostSampling",
          "SubagentStart", "SubagentEnd",
          "BeforeProviderRequest", "AfterProviderResponse",
          "SavePoint", "Abort", "Settled", "QueueUpdate",
          "ModelSelect", "ResourcesUpdate", "SystemPromptBuild", "ContextTransform",
        ];

        if (!validEvents.includes(event)) {
          warnings.push(`Unknown event: ${event}`);
        }

        // Validate matchers
        if (!Array.isArray(matchers)) {
          errors.push(`Hooks for ${event} must be an array`);
          continue;
        }

        for (const matcher of matchers) {
          if (!matcher.hooks || !Array.isArray(matcher.hooks)) {
            errors.push(`Matcher for ${event} must have a hooks array`);
            continue;
          }

          for (const hook of matcher.hooks) {
            if (!hook.id) {
              errors.push(`Hook in ${event} must have an id`);
              continue;
            }

            if (!hook.type || !["command", "function"].includes(hook.type)) {
              errors.push(`Hook ${hook.id} must have a valid type (command/function)`);
              continue;
            }

            if (hook.type === "command" && !hook.command) {
              errors.push(`Command hook ${hook.id} must have a command`);
              continue;
            }

            if (hook.type === "function" && !hook.function) {
              errors.push(`Function hook ${hook.id} must have a function reference`);
              continue;
            }

            if (hook.timeout && (hook.timeout < 1 || hook.timeout > 300)) {
              warnings.push(`Hook ${hook.id} timeout should be between 1 and 300 seconds`);
            }

            hookCount++;
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      hookCount,
    };
  }

  /**
   * Start watching config file for changes.
   */
  watch(): void {
    if (this.watcher) return;

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.watcher = fs.watch(dir, (eventType, filename) => {
      if (filename === path.basename(this.configPath)) {
        logger.info("[HookConfig] Config file changed, reloading");
        const newConfig = this.load();
        if (newConfig) {
          this.emitChange(newConfig);
        }
      }
    });

    logger.debug("[HookConfig] Started watching", { path: this.configPath });
  }

  /**
   * Stop watching config file.
   */
  unwatch(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.debug("[HookConfig] Stopped watching");
    }
  }

  /**
   * Subscribe to config changes.
   */
  onChange(listener: (config: HookConfigFile) => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index !== -1) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  private emitChange(config: HookConfigFile): void {
    for (const listener of this.changeListeners) {
      try {
        listener(config);
      } catch (error) {
        logger.error("[HookConfig] Change listener error", { error: String(error) });
      }
    }
  }

  /**
   * Add a hook to the configuration.
   */
  addHook(
    event: HookEventName,
    matcher: string | { tool?: string | string[]; tool_input?: Record<string, unknown> },
    hook: HookConfigEntry
  ): boolean {
    if (!this.config) {
      this.config = { hooks: {} };
    }

    if (!this.config.hooks[event]) {
      this.config.hooks[event] = [];
    }

    // Find or create matcher
    let matcherConfig = this.config.hooks[event].find(
      (m) => JSON.stringify(m.matchers) === JSON.stringify([matcher])
    );

    if (!matcherConfig) {
      matcherConfig = {
        event,
        matchers: [matcher],
        hooks: [],
      };
      this.config.hooks[event].push(matcherConfig);
    }

    // Add hook if not already present
    const existing = matcherConfig.hooks.find((h) => h.id === hook.id);
    if (!existing) {
      matcherConfig.hooks.push(hook);
    }

    return this.save(this.config);
  }

  /**
   * Remove a hook from the configuration.
   */
  removeHook(hookId: string): boolean {
    if (!this.config) return false;

    for (const matchers of Object.values(this.config.hooks)) {
      for (const matcher of matchers) {
        const index = matcher.hooks.findIndex((h) => h.id === hookId);
        if (index !== -1) {
          matcher.hooks.splice(index, 1);
          return this.save(this.config);
        }
      }
    }

    return false;
  }

  /**
   * Get all hooks for an event.
   */
  getHooksForEvent(event: HookEventName): HookConfigEntry[] {
    if (!this.config?.hooks[event]) return [];

    const hooks: HookConfigEntry[] = [];
    for (const matcher of this.config.hooks[event]) {
      hooks.push(...matcher.hooks);
    }
    return hooks;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let managerInstance: HookConfigManager | null = null;

/**
 * Get the singleton hook config manager.
 */
export function getHookConfigManager(configDir?: string): HookConfigManager {
  if (!managerInstance) {
    managerInstance = new HookConfigManager(configDir);
  }
  return managerInstance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetHookConfigManager(): void {
  if (managerInstance) {
    managerInstance.unwatch();
  }
  managerInstance = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load hook configuration from default path.
 */
export function loadHookConfig(): HookConfigFile | null {
  return getHookConfigManager().load();
}

/**
 * Get all configured hooks for an event.
 */
export function getConfiguredHooks(event: HookEventName): HookConfigEntry[] {
  return getHookConfigManager().getHooksForEvent(event);
}

/**
 * Add a hook to the default configuration.
 */
export function addHookToConfig(
  event: HookEventName,
  matcher: string | { tool?: string | string[]; tool_input?: Record<string, unknown> },
  hook: HookConfigEntry
): boolean {
  return getHookConfigManager().addHook(event, matcher, hook);
}
