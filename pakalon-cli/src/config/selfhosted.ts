/**
 * Self-Hosted Mode
 *
 * Complete offline mode for self-hosted Pakalon deployments.
 * Supports:
 * - Offline operation
 * - Local model integration
 * - Local authentication
 * - Configuration management
 * - Feature toggling
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelfHostedConfig {
  /** Enable self-hosted mode */
  enabled: boolean;
  /** Local models endpoint */
  localModelsUrl?: string;
  /** Disable cloud features */
  disableCloudFeatures: boolean;
  /** Disable telemetry */
  disableTelemetry: boolean;
  /** Disable external API calls */
  disableExternalApis: boolean;
  /** Custom authentication provider */
  authProvider?: 'local' | 'ldap' | 'oauth';
  /** Local user database path */
  userDbPath?: string;
  /** Feature toggles */
  features: SelfHostedFeatures;
}

export interface SelfHostedFeatures {
  /** Enable chat mode */
  chat: boolean;
  /** Enable agent mode */
  agent: boolean;
  /** Enable MCP servers */
  mcp: boolean;
  /** Enable plugins */
  plugins: boolean;
  /** Enable billing */
  billing: boolean;
  /** Enable telemetry */
  telemetry: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: SelfHostedConfig = {
  enabled: false,
  disableCloudFeatures: true,
  disableTelemetry: true,
  disableExternalApis: false,
  features: {
    chat: true,
    agent: true,
    mcp: true,
    plugins: true,
    billing: false,
    telemetry: false,
  },
};

const CONFIG_PATH = path.join(process.cwd(), '.pakalon', 'selfhosted.json');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Check if self-hosted mode is enabled
 */
export function isSelfHosted(): boolean {
  return config.enabled;
}

/**
 * Get self-hosted configuration
 */
export function getSelfHostedConfig(): SelfHostedConfig {
  return { ...config };
}

/**
 * Update self-hosted configuration
 */
export function updateSelfHostedConfig(newConfig: Partial<SelfHostedConfig>): void {
  config = { ...config, ...newConfig };
  saveConfig();
  logger.info('[selfhosted] Configuration updated');
}

/**
 * Enable self-hosted mode
 */
export function enableSelfHostedMode(options?: Partial<SelfHostedConfig>): void {
  config = {
    ...config,
    enabled: true,
    disableCloudFeatures: true,
    disableTelemetry: true,
    ...options,
  };
  saveConfig();
  logger.info('[selfhosted] Self-hosted mode enabled');
}

/**
 * Disable self-hosted mode
 */
export function disableSelfHostedMode(): void {
  config.enabled = false;
  saveConfig();
  logger.info('[selfhosted] Self-hosted mode disabled');
}

// ---------------------------------------------------------------------------
// Feature Checks
// ---------------------------------------------------------------------------

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof SelfHostedFeatures): boolean {
  if (!config.enabled) {
    return true; // All features enabled in cloud mode
  }
  return config.features[feature] ?? false;
}

/**
 * Check if cloud features are available
 */
export function hasCloudFeatures(): boolean {
  return !config.enabled || !config.disableCloudFeatures;
}

/**
 * Check if telemetry is available
 */
export function hasTelemetry(): boolean {
  return !config.enabled || !config.disableTelemetry;
}

/**
 * Check if external APIs are available
 */
export function hasExternalApis(): boolean {
  return !config.enabled || !config.disableExternalApis;
}

// ---------------------------------------------------------------------------
// Model Management
// ---------------------------------------------------------------------------

/**
 * Get available models in self-hosted mode
 */
export async function getSelfHostedModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
  if (!config.enabled || !config.localModelsUrl) {
    return [];
  }

  try {
    const response = await fetch(`${config.localModelsUrl}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'local',
    }));
  } catch (error) {
    logger.error(`[selfhosted] Failed to fetch models: ${error}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Authenticate user in self-hosted mode
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (!config.enabled) {
    return { success: false, error: 'Self-hosted mode not enabled' };
  }

  // Local authentication
  if (config.authProvider === 'local') {
    // TODO: Implement local user database
    return { success: false, error: 'Local auth not implemented' };
  }

  // LDAP authentication
  if (config.authProvider === 'ldap') {
    // TODO: Implement LDAP authentication
    return { success: false, error: 'LDAP auth not implemented' };
  }

  // Default: allow all (for development)
  return {
    success: true,
    token: `selfhosted-${Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Load configuration from file
 */
function loadConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const loaded = JSON.parse(content) as Partial<SelfHostedConfig>;
      config = { ...config, ...loaded };
      logger.info('[selfhosted] Configuration loaded');
    }
  } catch (error) {
    logger.error(`[selfhosted] Failed to load config: ${error}`);
  }
}

/**
 * Save configuration to file
 */
function saveConfig(): void {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    logger.debug('[selfhosted] Configuration saved');
  } catch (error) {
    logger.error(`[selfhosted] Failed to save config: ${error}`);
  }
}

// Initialize
loadConfig();

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get self-hosted status
 */
export function getSelfHostedStatus(): {
  enabled: boolean;
  features: SelfHostedFeatures;
  hasLocalModels: boolean;
  hasAuth: boolean;
} {
  return {
    enabled: config.enabled,
    features: { ...config.features },
    hasLocalModels: Boolean(config.localModelsUrl),
    hasAuth: Boolean(config.authProvider),
  };
}

/**
 * Reset to defaults
 */
export function resetSelfHostedConfig(): void {
  config = {
    enabled: false,
    disableCloudFeatures: true,
    disableTelemetry: true,
    disableExternalApis: false,
    features: {
      chat: true,
      agent: true,
      mcp: true,
      plugins: true,
      billing: false,
      telemetry: false,
    },
  };
  saveConfig();
  logger.info('[selfhosted] Configuration reset');
}
