/**
 * Multi-Provider Routing
 * 
 * Routes requests across multiple LLM providers with fallback chains.
 * Based on OMP's provider routing system.
 */

import logger from '@/utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'azure' | 'local';
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  priority: number;
  enabled: boolean;
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

export interface FallbackChain {
  name: string;
  providers: string[];
  retryOnFailure: boolean;
  maxRetries: number;
}

export interface ModelRole {
  role: string;
  provider: string;
  model: string;
  pathScoped?: Record<string, string>; // path prefix -> model override
}

export interface ProviderHealth {
  provider: string;
  healthy: boolean;
  lastCheck: number;
  errorCount: number;
  avgLatency: number;
}

// ============================================================================
// Provider Router
// ============================================================================

export class ProviderRouter {
  private providers: Map<string, ProviderConfig> = new Map();
  private fallbackChains: Map<string, FallbackChain> = new Map();
  private modelRoles: Map<string, ModelRole> = new Map();
  private health: Map<string, ProviderHealth> = new Map();
  private credentials: Map<string, string[]> = new Map(); // provider -> API keys
  private credentialIndex: Map<string, number> = new Map(); // current index per provider

  /**
   * Register a provider
   */
  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.name, config);
    this.health.set(config.name, {
      provider: config.name,
      healthy: true,
      lastCheck: Date.now(),
      errorCount: 0,
      avgLatency: 0,
    });
    logger.debug('[provider-router] Registered provider', { name: config.name });
  }

  /**
   * Register API keys for a provider (round-robin)
   */
  registerCredentials(provider: string, keys: string[]): void {
    this.credentials.set(provider, keys);
    this.credentialIndex.set(provider, 0);
  }

  /**
   * Get next API key for a provider (round-robin)
   */
  getNextCredential(provider: string): string | undefined {
    const keys = this.credentials.get(provider);
    if (!keys || keys.length === 0) return undefined;

    const index = this.credentialIndex.get(provider) || 0;
    const key = keys[index % keys.length];
    this.credentialIndex.set(provider, (index + 1) % keys.length);
    return key;
  }

  /**
   * Create a fallback chain
   */
  createFallbackChain(config: FallbackChain): void {
    this.fallbackChains.set(config.name, config);
    logger.debug('[provider-router] Created fallback chain', { name: config.name, providers: config.providers });
  }

  /**
   * Set model role
   */
  setModelRole(role: ModelRole): void {
    this.modelRoles.set(role.role, role);
  }

  /**
   * Get model for a role (with path-scoping)
   */
  getModelForRole(role: string, path?: string): { provider: string; model: string } | null {
    const modelRole = this.modelRoles.get(role);
    if (!modelRole) return null;

    // Check path-scoped overrides
    if (path && modelRole.pathScoped) {
      for (const [prefix, overrideModel] of Object.entries(modelRole.pathScoped)) {
        if (path.startsWith(prefix)) {
          return { provider: modelRole.provider, model: overrideModel };
        }
      }
    }

    return { provider: modelRole.provider, model: modelRole.model };
  }

  /**
   * Select provider with fallback
   */
  selectProvider(
    preferredProvider?: string,
    preferredModel?: string
  ): { provider: ProviderConfig; model: string; credential?: string } | null {
    // Try preferred provider first
    if (preferredProvider) {
      const provider = this.providers.get(preferredProvider);
      if (provider && provider.enabled && this.isHealthy(preferredProvider)) {
        const model = preferredModel || provider.models[0];
        const credential = this.getNextCredential(preferredProvider);
        return { provider, model, credential };
      }
    }

    // Try fallback chain
    for (const chain of this.fallbackChains.values()) {
      for (const providerName of chain.providers) {
        const provider = this.providers.get(providerName);
        if (provider && provider.enabled && this.isHealthy(providerName)) {
          const model = preferredModel || provider.models[0];
          const credential = this.getNextCredential(providerName);
          return { provider, model, credential };
        }
      }
    }

    // Try any healthy provider
    for (const provider of this.providers.values()) {
      if (provider.enabled && this.isHealthy(provider.name)) {
        const model = preferredModel || provider.models[0];
        const credential = this.getNextCredential(provider.name);
        return { provider, model, credential };
      }
    }

    return null;
  }

  /**
   * Check if a provider is healthy
   */
  isHealthy(providerName: string): boolean {
    const health = this.health.get(providerName);
    return health?.healthy ?? false;
  }

  /**
   * Report provider health
   */
  reportHealth(providerName: string, healthy: boolean, latency?: number): void {
    const health = this.health.get(providerName);
    if (health) {
      health.healthy = healthy;
      health.lastCheck = Date.now();
      if (!healthy) {
        health.errorCount++;
      }
      if (latency !== undefined) {
        health.avgLatency = (health.avgLatency + latency) / 2;
      }
    }
  }

  /**
   * Get provider health
   */
  getHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * List all providers
   */
  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  /**
   * List all fallback chains
   */
  listFallbackChains(): FallbackChain[] {
    return Array.from(this.fallbackChains.values());
  }

  /**
   * List all model roles
   */
  listModelRoles(): ModelRole[] {
    return Array.from(this.modelRoles.values());
  }

  /**
   * Clear all providers
   */
  clear(): void {
    this.providers.clear();
    this.fallbackChains.clear();
    this.modelRoles.clear();
    this.health.clear();
    this.credentials.clear();
    this.credentialIndex.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let routerInstance: ProviderRouter | null = null;

export function getProviderRouter(): ProviderRouter {
  if (!routerInstance) {
    routerInstance = new ProviderRouter();
    
    // Load default providers
    loadDefaultProviders(routerInstance);
  }
  return routerInstance;
}

export function resetProviderRouter(): void {
  routerInstance = null;
}

// ============================================================================
// Default Providers
// ============================================================================

function loadDefaultProviders(router: ProviderRouter): void {
  // OpenRouter
  router.registerProvider({
    name: 'openrouter',
    type: 'openai',
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4', 'google/gemini-pro'],
    priority: 1,
    enabled: true,
  });

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    router.registerProvider({
      name: 'openai',
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      priority: 2,
      enabled: true,
    });
  }

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    router.registerProvider({
      name: 'anthropic',
      type: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      models: ['claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
      priority: 3,
      enabled: true,
    });
  }

  // Google
  if (process.env.GOOGLE_API_KEY) {
    router.registerProvider({
      name: 'google',
      type: 'google',
      apiKey: process.env.GOOGLE_API_KEY,
      models: ['gemini-pro', 'gemini-flash'],
      priority: 4,
      enabled: true,
    });
  }

  // Default fallback chain
  router.createFallbackChain({
    name: 'default',
    providers: ['openrouter', 'openai', 'anthropic', 'google'],
    retryOnFailure: true,
    maxRetries: 3,
  });

  // Default model roles
  router.setModelRole({ role: 'default', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' });
  router.setModelRole({ role: 'smol', provider: 'openrouter', model: 'google/gemini-flash' });
  router.setModelRole({ role: 'slow', provider: 'openrouter', model: 'anthropic/claude-3-opus' });
  router.setModelRole({ role: 'plan', provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' });
}
