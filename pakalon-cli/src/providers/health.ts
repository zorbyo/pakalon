/**
 * Provider Health Check Utilities for Pakalon CLI
 *
 * Monitors health and latency of local and cloud providers.
 */

import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderType = "local" | "cloud";
export type HealthStatus = "healthy" | "degraded" | "down";

export interface ProviderHealth {
  providerId: string;
  providerType: ProviderType;
  status: HealthStatus;
  latencyMs: number;
  lastChecked: Date;
  error?: string;
  modelCount?: number;
}

export interface HealthCheckOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: HealthCheckOptions = {
  timeout: 5000,
  retries: 2,
  retryDelay: 1000,
};

// ---------------------------------------------------------------------------
// Provider Health Checker
// ---------------------------------------------------------------------------

export class ProviderHealthChecker {
  private healthCache: Map<string, ProviderHealth> = new Map();
  private lastCheck: Map<string, number> = new Map();

  /**
   * Check health of a single provider
   */
  async checkProvider(
    providerId: string,
    baseUrl: string,
    providerType: ProviderType,
    options: HealthCheckOptions = {}
  ): Promise<ProviderHealth> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    try {
      if (providerType === "local") {
        await this.checkLocalProvider(baseUrl, opts);
      } else {
        await this.checkCloudProvider(baseUrl, opts);
      }

      const latency = Date.now() - startTime;

      const health: ProviderHealth = {
        providerId,
        providerType,
        status: latency < 1000 ? "healthy" : "degraded",
        latencyMs: latency,
        lastChecked: new Date(),
      };

      this.healthCache.set(providerId, health);
      this.lastCheck.set(providerId, Date.now());
      return health;
    } catch (error) {
      const latency = Date.now() - startTime;
      const health: ProviderHealth = {
        providerId,
        providerType,
        status: "down",
        latencyMs: latency,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };

      this.healthCache.set(providerId, health);
      this.lastCheck.set(providerId, Date.now());
      return health;
    }
  }

  /**
   * Check local provider (Ollama or LM Studio)
   */
  private async checkLocalProvider(baseUrl: string, options: HealthCheckOptions): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout);

    try {
      // Try Ollama endpoint first
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          method: "GET",
          signal: controller.signal,
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Ignore Ollama error, try LM Studio
      }

      // Try LM Studio endpoint
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          method: "GET",
          signal: controller.signal,
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Ignore LM Studio error
      }

      throw new Error(`Cannot connect to provider at ${baseUrl}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check cloud provider (OpenRouter)
   */
  private async checkCloudProvider(baseUrl: string, options: HealthCheckOptions): Promise<void> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenRouter returned status ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get cached health status for a provider
   */
  getHealth(providerId: string): ProviderHealth | undefined {
    return this.healthCache.get(providerId);
  }

  /**
   * Get health status for all providers
   */
  getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthCache.values());
  }

  /**
   * Check health of all configured providers
   */
  async checkAllProviders(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];

    // Check local providers
    const ollamaUrl = process.env.PAKALON_OLLAMA_URL || "http://localhost:11434";
    const lmstudioUrl = process.env.PAKALON_LMSTUDIO_URL || "http://localhost:1234";

    const ollamaHealth = await this.checkProvider("ollama", ollamaUrl, "local");
    results.push(ollamaHealth);

    const lmstudioHealth = await this.checkProvider("lmstudio", lmstudioUrl, "local");
    results.push(lmstudioHealth);

    // Check cloud providers
    if (process.env.OPENROUTER_API_KEY) {
      const openrouterHealth = await this.checkProvider(
        "openrouter",
        "https://openrouter.ai/api/v1",
        "cloud"
      );
      results.push(openrouterHealth);
    }

    return results;
  }

  /**
   * Check if a provider is healthy
   */
  isProviderHealthy(providerId: string): boolean {
    const health = this.healthCache.get(providerId);
    return health !== undefined && health.status !== "down";
  }

  /**
   * Get list of healthy provider IDs
   */
  getHealthyProviders(): string[] {
    return Array.from(this.healthCache.entries())
      .filter(([_, health]) => health.status !== "down")
      .map(([id, _]) => id);
  }

  /**
   * Clear health cache
   */
  clearCache(): void {
    this.healthCache.clear();
    this.lastCheck.clear();
  }
}

// Global instance
export const healthChecker = new ProviderHealthChecker();

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Check provider health
 */
export async function checkProviderHealth(
  providerId: string,
  baseUrl: string,
  providerType: ProviderType,
  options?: HealthCheckOptions
): Promise<ProviderHealth> {
  return healthChecker.checkProvider(providerId, baseUrl, providerType, options);
}

/**
 * Check all providers health
 */
export async function checkAllProvidersHealth(): Promise<ProviderHealth[]> {
  return healthChecker.checkAllProviders();
}

/**
 * Get provider health status
 */
export function getProviderHealth(providerId: string): ProviderHealth | undefined {
  return healthChecker.getHealth(providerId);
}

/**
 * Check if provider is healthy
 */
export function isProviderHealthy(providerId: string): boolean {
  return healthChecker.isProviderHealthy(providerId);
}
