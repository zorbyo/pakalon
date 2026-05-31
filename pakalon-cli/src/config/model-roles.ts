/**
 * Model Roles and Routing System
 * 
 * Implements role-based model routing similar to OMP's model roles:
 * - default: Normal turns
 * - smol: Cheap subagent fan-out
 * - slow: Deep reasoning
 * - plan: Plan mode
 * - commit: Changelogs
 * 
 * Features:
 * - Role-based model selection
 * - Fallback chains per role
 * - Path-scoped roles (different models for different directories)
 * - Round-robin credentials
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type ModelRole = 'default' | 'smol' | 'slow' | 'plan' | 'commit';

export interface ModelReference {
  providerID: string;
  modelID: string;
}

export interface ModelRoleConfig {
  /** Primary model for this role */
  primary: ModelReference;
  /** Fallback models in order of preference */
  fallbacks: ModelReference[];
  /** Path-scoped overrides */
  pathOverrides?: Array<{
    path: string;
    model: ModelReference;
  }>;
}

export interface ModelRoutingConfig {
  /** Role configurations */
  roles: Partial<Record<ModelRole, ModelRoleConfig>>;
  /** Global fallback chain */
  globalFallbacks: ModelReference[];
  /** Round-robin credentials per provider */
  credentials?: Record<string, string[]>;
}

export interface ResolvedModel {
  providerID: string;
  modelID: string;
  role: ModelRole;
  source: 'role' | 'fallback' | 'path-override' | 'global-fallback';
}

// ============================================================================
// Model Role Manager
// ============================================================================

export class ModelRoleManager {
  private config: ModelRoutingConfig;
  private credentialIndex: Map<string, number> = new Map();

  constructor(config?: Partial<ModelRoutingConfig>) {
    this.config = {
      roles: config?.roles ?? {},
      globalFallbacks: config?.globalFallbacks ?? [],
      credentials: config?.credentials,
    };
  }

  /**
   * Get the model for a given role and optional path
   */
  getModel(role: ModelRole, cwd?: string): ResolvedModel | null {
    const roleConfig = this.config.roles[role];
    
    if (roleConfig) {
      // Check path-scoped overrides first
      if (cwd && roleConfig.pathOverrides) {
        for (const override of roleConfig.pathOverrides) {
          if (cwd.startsWith(override.path)) {
            return {
              ...override.model,
              role,
              source: 'path-override',
            };
          }
        }
      }

      // Use primary model
      return {
        ...roleConfig.primary,
        role,
        source: 'role',
      };
    }

    // No role config, try global fallbacks
    if (this.config.globalFallbacks.length > 0) {
      return {
        ...this.config.globalFallbacks[0],
        role,
        source: 'global-fallback',
      };
    }

    return null;
  }

  /**
   * Get fallback models for a role
   */
  getFallbacks(role: ModelRole): ModelReference[] {
    const roleConfig = this.config.roles[role];
    if (roleConfig?.fallbacks) {
      return roleConfig.fallbacks;
    }
    return this.config.globalFallbacks;
  }

  /**
   * Get the next credential for a provider (round-robin)
   */
  getNextCredential(providerID: string): string | null {
    const credentials = this.config.credentials?.[providerID];
    if (!credentials || credentials.length === 0) {
      return null;
    }

    const currentIndex = this.credentialIndex.get(providerID) ?? 0;
    const nextIndex = (currentIndex + 1) % credentials.length;
    this.credentialIndex.set(providerID, nextIndex);

    return credentials[currentIndex];
  }

  /**
   * Update role configuration
   */
  setRoleConfig(role: ModelRole, config: ModelRoleConfig): void {
    this.config.roles[role] = config;
    logger.debug('[model-roles] Updated role config', { role });
  }

  /**
   * Add path-scoped override to a role
   */
  addPathOverride(role: ModelRole, path: string, model: ModelReference): void {
    let roleConfig = this.config.roles[role];
    if (!roleConfig) {
      roleConfig = { primary: model, fallbacks: [] };
      this.config.roles[role] = roleConfig;
    }

    if (!roleConfig.pathOverrides) {
      roleConfig.pathOverrides = [];
    }

    // Remove existing override for this path
    roleConfig.pathOverrides = roleConfig.pathOverrides.filter(o => o.path !== path);
    
    // Add new override
    roleConfig.pathOverrides.push({ path, model });
    logger.debug('[model-roles] Added path override', { role, path });
  }

  /**
   * Remove path-scoped override
   */
  removePathOverride(role: ModelRole, path: string): boolean {
    const roleConfig = this.config.roles[role];
    if (!roleConfig?.pathOverrides) {
      return false;
    }

    const initialLength = roleConfig.pathOverrides.length;
    roleConfig.pathOverrides = roleConfig.pathOverrides.filter(o => o.path !== path);
    
    return roleConfig.pathOverrides.length < initialLength;
  }

  /**
   * Get all configured roles
   */
  getConfiguredRoles(): ModelRole[] {
    return Object.keys(this.config.roles) as ModelRole[];
  }

  /**
   * Export current configuration
   */
  exportConfig(): ModelRoutingConfig {
    return { ...this.config };
  }

  /**
   * Import configuration
   */
  importConfig(config: Partial<ModelRoutingConfig>): void {
    if (config.roles) {
      this.config.roles = { ...this.config.roles, ...config.roles };
    }
    if (config.globalFallbacks) {
      this.config.globalFallbacks = config.globalFallbacks;
    }
    if (config.credentials) {
      this.config.credentials = { ...this.config.credentials, ...config.credentials };
    }
    logger.debug('[model-roles] Imported config');
  }
}

// ============================================================================
// Default Configuration
// ============================================================================

export function createDefaultModelRoles(): ModelRoleManager {
  return new ModelRoleManager({
    roles: {
      default: {
        primary: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
        fallbacks: [
          { providerID: 'openai', modelID: 'gpt-4o' },
          { providerID: 'google', modelID: 'gemini-2.0-flash' },
        ],
      },
      smol: {
        primary: { providerID: 'anthropic', modelID: 'claude-haiku-3.5' },
        fallbacks: [
          { providerID: 'openai', modelID: 'gpt-4o-mini' },
          { providerID: 'google', modelID: 'gemini-2.0-flash' },
        ],
      },
      slow: {
        primary: { providerID: 'anthropic', modelID: 'claude-opus-4' },
        fallbacks: [
          { providerID: 'openai', modelID: 'o3' },
          { providerID: 'google', modelID: 'gemini-2.5-pro' },
        ],
      },
      plan: {
        primary: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
        fallbacks: [
          { providerID: 'openai', modelID: 'gpt-4o' },
        ],
      },
      commit: {
        primary: { providerID: 'anthropic', modelID: 'claude-haiku-3.5' },
        fallbacks: [
          { providerID: 'openai', modelID: 'gpt-4o-mini' },
        ],
      },
    },
    globalFallbacks: [
      { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' },
      { providerID: 'openai', modelID: 'gpt-4o' },
    ],
  });
}

// ============================================================================
// Singleton
// ============================================================================

let _globalManager: ModelRoleManager | null = null;

export function getModelRoleManager(): ModelRoleManager {
  if (!_globalManager) {
    _globalManager = createDefaultModelRoles();
  }
  return _globalManager;
}

export function resetModelRoleManager(): void {
  _globalManager = null;
}
