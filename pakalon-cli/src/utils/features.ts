/**
 * Feature Flags System
 *
 * Provides runtime feature flag management similar to Claude's bun:bundle pattern.
 * Supports environment variables, config files, and runtime toggling.
 *
 * Usage:
 *   import { feature, enableFeature, disableFeature, isFeatureEnabled } from '@/utils/features.js';
 *
 *   if (feature('PROACTIVE')) {
 *     // Load proactive module
 *   }
 *
 *   // Or check directly
 *   if (isFeatureEnabled('VOICE_MODE')) {
 *     // Enable voice features
 *   }
 */

import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureFlag =
  | "PROACTIVE"
  | "VOICE_MODE"
  | "WORKFLOW_SCRIPTS"
  | "EXPERIMENTAL_SKILL_SEARCH"
  | "REMOTE_AGENTS"
  | "AGENT_SWARMS"
  | "IMAGE_GENERATION"
  | "TELEGRAM_INTEGRATION"
  | "OLLAMA_SUPPORT"
  | "SANDBOX_MODE"
  | "BRIDGE_MODE"
  | "DAEMON"
  | "CCR_REMOTE_SETUP"
  | "HISTORY_SNIP"
  | "KAIROS"
  | "KAIROS_BRIEF"
  | "BREAK_CACHE_COMMAND"
  | "DEBUG_TOOL_CALLS"
  | "ADVANCED_SECURITY"
  | "CLOUD_DEPLOYMENT"
  | "EMAIL_NOTIFICATIONS"
  | string;

export interface FeatureFlagsConfig {
  /** Environment variable prefix */
  envPrefix?: string;
  /** Config file path */
  configFile?: string;
  /** Default flags */
  defaults?: Partial<Record<FeatureFlag, boolean>>;
}

export interface FeatureFlagState {
  /** Currently enabled flags */
  enabled: Set<string>;
  /** Flag sources (env, config, runtime) */
  sources: Map<string, "env" | "config" | "runtime" | "default">;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENV_PREFIX = "PAKALON_FEATURE_";
const CONFIG_FILE = ".pakalon-features.json";

// Default feature flags - enable by default
const DEFAULT_FEATURE_FLAGS: Partial<Record<FeatureFlag, boolean>> = {
  PROACTIVE: false,
  VOICE_MODE: true,
  WORKFLOW_SCRIPTS: true,
  EXPERIMENTAL_SKILL_SEARCH: true,
  REMOTE_AGENTS: false,
  AGENT_SWARMS: true,
  IMAGE_GENERATION: true,
  TELEGRAM_INTEGRATION: true,
  OLLAMA_SUPPORT: true,
  SANDBOX_MODE: true,
  BRIDGE_MODE: false,
  DAEMON: false,
  CCR_REMOTE_SETUP: false,
  HISTORY_SNIP: true,
  KAIROS: false,
  KAIROS_BRIEF: false,
  BREAK_CACHE_COMMAND: false,
  DEBUG_TOOL_CALLS: false,
  ADVANCED_SECURITY: true,
  CLOUD_DEPLOYMENT: true,
  EMAIL_NOTIFICATIONS: true,
};

// ---------------------------------------------------------------------------
// Feature Flags Manager
// ---------------------------------------------------------------------------

class FeatureFlagsManager {
  private state: FeatureFlagState = {
    enabled: new Set(),
    sources: new Map(),
  };

  private config: FeatureFlagsConfig;
  private initialized = false;

  constructor(config: FeatureFlagsConfig = {}) {
    this.config = {
      envPrefix: ENV_PREFIX,
      configFile: CONFIG_FILE,
      defaults: DEFAULT_FEATURE_FLAGS,
      ...config,
    };
  }

  /**
   * Initialize feature flags from environment and config
   */
  initialize(): void {
    if (this.initialized) return;

    // 1. Load defaults
    if (this.config.defaults) {
      for (const [flag, enabled] of Object.entries(this.config.defaults)) {
        if (enabled) {
          this.state.enabled.add(flag);
          this.state.sources.set(flag, "default");
        }
      }
    }

    // 2. Load from environment variables
    this.loadFromEnvironment();

    // 3. Load from config file
    this.loadFromConfigFile();

    this.initialized = true;
    logger.debug(`[Features] Initialized with ${this.state.enabled.size} flags enabled`);
  }

  /**
   * Load feature flags from environment variables
   */
  private loadFromEnvironment(): void {
    const prefix = this.config.envPrefix || ENV_PREFIX;

    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(prefix)) {
        const flagName = key.slice(prefix.length);
        const enabled = this.parseEnvValue(value);

        if (enabled) {
          this.state.enabled.add(flagName);
          this.state.sources.set(flagName, "env");
        } else {
          this.state.enabled.delete(flagName);
          this.state.sources.set(flagName, "env");
        }
      }
    }
  }

  /**
   * Load feature flags from config file
   */
  private loadFromConfigFile(): void {
    try {
      const configPath = this.getConfigPath();
      if (!fs.existsSync(configPath)) return;

      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);

      if (config.features && typeof config.features === "object") {
        for (const [flag, enabled] of Object.entries(config.features)) {
          if (typeof enabled === "boolean") {
            if (enabled) {
              this.state.enabled.add(flag);
              this.state.sources.set(flag, "config");
            } else {
              this.state.enabled.delete(flag);
              this.state.sources.set(flag, "config");
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`[Features] Failed to load config file: ${error}`);
    }
  }

  /**
   * Get config file path
   */
  private getConfigPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(homeDir, ".pakalon", this.config.configFile || CONFIG_FILE);
  }

  /**
   * Parse environment variable value to boolean
   */
  private parseEnvValue(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.toLowerCase().trim();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  /**
   * Check if a feature flag is enabled
   */
  isEnabled(flag: FeatureFlag): boolean {
    this.initialize();
    return this.state.enabled.has(flag);
  }

  /**
   * Enable a feature flag at runtime
   */
  enable(flag: FeatureFlag): void {
    this.initialize();
    this.state.enabled.add(flag);
    this.state.sources.set(flag, "runtime");
    logger.debug(`[Features] Enabled: ${flag}`);
  }

  /**
   * Disable a feature flag at runtime
   */
  disable(flag: FeatureFlag): void {
    this.initialize();
    this.state.enabled.delete(flag);
    this.state.sources.set(flag, "runtime");
    logger.debug(`[Features] Disabled: ${flag}`);
  }

  /**
   * Toggle a feature flag
   */
  toggle(flag: FeatureFlag): boolean {
    if (this.isEnabled(flag)) {
      this.disable(flag);
      return false;
    } else {
      this.enable(flag);
      return true;
    }
  }

  /**
   * Get all enabled flags
   */
  getEnabledFlags(): string[] {
    this.initialize();
    return Array.from(this.state.enabled);
  }

  /**
   * Get flag source (env, config, runtime, default)
   */
  getSource(flag: FeatureFlag): "env" | "config" | "runtime" | "default" | undefined {
    this.initialize();
    return this.state.sources.get(flag);
  }

  /**
   * Save current flags to config file
   */
  saveToConfigFile(): void {
    try {
      const configPath = this.getConfigPath();
      const dir = path.dirname(configPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const features: Record<string, boolean> = {};
      for (const flag of this.state.enabled) {
        features[flag] = true;
      }

      fs.writeFileSync(
        configPath,
        JSON.stringify({ features }, null, 2),
        "utf-8"
      );

      logger.debug(`[Features] Saved ${this.state.enabled.size} flags to config`);
    } catch (error) {
      logger.error(`[Features] Failed to save config: ${error}`);
    }
  }

  /**
   * Reset all flags to defaults
   */
  reset(): void {
    this.state.enabled.clear();
    this.state.sources.clear();
    this.initialized = false;
    logger.debug("[Features] Reset to defaults");
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let manager: FeatureFlagsManager | null = null;

function getManager(): FeatureFlagsManager {
  if (!manager) {
    manager = new FeatureFlagsManager();
  }
  return manager;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a feature flag is enabled (main API)
 *
 * @example
 *   if (feature('PROACTIVE')) {
 *     const proactive = await import('./proactive/index.js');
 *   }
 */
export function feature(flag: FeatureFlag): boolean {
  return getManager().isEnabled(flag);
}

/**
 * Enable a feature flag at runtime
 */
export function enableFeature(flag: FeatureFlag): void {
  getManager().enable(flag);
}

/**
 * Disable a feature flag at runtime
 */
export function disableFeature(flag: FeatureFlag): void {
  getManager().disable(flag);
}

/**
 * Toggle a feature flag
 */
export function toggleFeature(flag: FeatureFlag): boolean {
  return getManager().toggle(flag);
}

/**
 * Check if a feature flag is enabled (alias for feature())
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return feature(flag);
}

/**
 * Get all enabled flags
 */
export function getEnabledFeatures(): string[] {
  return getManager().getEnabledFlags();
}

/**
 * Get flag source
 */
export function getFeatureSource(flag: FeatureFlag): string | undefined {
  return getManager().getSource(flag);
}

/**
 * Save current flags to config file
 */
export function saveFeatureFlags(): void {
  getManager().saveToConfigFile();
}

/**
 * Reset all flags
 */
export function resetFeatureFlags(): void {
  getManager().reset();
}

/**
 * Configure the feature flags manager
 */
export function configureFeatureFlags(config: FeatureFlagsConfig): void {
  manager = new FeatureFlagsManager(config);
}

/**
 * Load feature flags from a GrowthBook-like remote config
 * (Stub for future implementation)
 */
export function loadRemoteFeatureFlags(config: Record<string, boolean>): void {
  for (const [flag, enabled] of Object.entries(config)) {
    if (enabled) {
      enableFeature(flag);
    } else {
      disableFeature(flag);
    }
  }
  logger.info(`[Features] Loaded ${Object.keys(config).length} remote flags`);
}
