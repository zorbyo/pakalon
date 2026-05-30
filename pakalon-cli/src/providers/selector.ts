/**
 * Model Selection Algorithm for Pakalon CLI
 *
 * Intelligently selects the best model based on requirements, health, and preferences.
 */

import logger from "@/utils/logger.js";
import { healthChecker, type ProviderHealth } from "./health.js";
import { getFeatureFlags } from "@/config/features.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelRequirements {
  minContextWindow?: number;
  maxLatency?: number;
  preferredProviders?: string[];
  excludeProviders?: string[];
  requireCapabilities?: string[];
  preferLocal?: boolean;
}

export interface ModelScore {
  providerId: string;
  modelId: string;
  score: number;
  health: ProviderHealth | undefined;
  reasons: string[];
}

export interface ModelSelectionOptions {
  requirements?: ModelRequirements;
  fallbackToAny?: boolean;
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Default Configurations
// ---------------------------------------------------------------------------

const DEFAULT_REQUIREMENTS: ModelRequirements = {
  minContextWindow: 4096,
  maxLatency: 5000,
  preferredProviders: [],
  excludeProviders: [],
  requireCapabilities: [],
  preferLocal: false,
};

// ---------------------------------------------------------------------------
// Model Selector
// ---------------------------------------------------------------------------

export class ModelSelector {
  private healthCache: Map<string, ProviderHealth> = new Map();

  /**
   * Select the best model based on requirements
   */
  async selectModel(
    requirements: ModelRequirements = {},
    options: ModelSelectionOptions = {}
  ): Promise<{ providerId: string; modelId: string } | null> {
    const reqs = { ...DEFAULT_REQUIREMENTS, ...requirements };
    const opts = { fallbackToAny: true, maxRetries: 2, ...options };

    // Get available providers
    const availableProviders = this.getAvailableProviders(reqs);

    if (availableProviders.length === 0) {
      logger.warn("[ModelSelector] No available providers");
      return null;
    }

    // Score each provider
    const scores: ModelScore[] = [];

    for (const providerId of availableProviders) {
      const score = await this.scoreProvider(providerId, reqs);
      if (score) {
        scores.push(score);
      }
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    if (scores.length === 0) {
      if (opts.fallbackToAny) {
        // Fallback to any available provider
        return this.fallbackSelection(availableProviders);
      }
      return null;
    }

    const best = scores[0];
    logger.info(
      `[ModelSelector] Selected ${best.providerId}/${best.modelId} (score: ${best.score})`
    );
    logger.debug(`[ModelSelector] Reasons: ${best.reasons.join(", ")}`);

    return {
      providerId: best.providerId,
      modelId: best.modelId,
    };
  }

  /**
   * Get available providers based on requirements
   */
  private getAvailableProviders(requirements: ModelRequirements): string[] {
    const flags = getFeatureFlags();
    const providers: string[] = [];

    // Add local providers if enabled
    if (flags.localModels) {
      providers.push("ollama", "lmstudio");
    }

    // Add cloud providers if enabled
    if (flags.cloudProviders) {
      providers.push("openrouter");
    }

    // Filter by exclusions
    if (requirements.excludeProviders) {
      return providers.filter((p) => !requirements.excludeProviders!.includes(p));
    }

    return providers;
  }

  /**
   * Score a provider based on requirements
   */
  private async scoreProvider(
    providerId: string,
    requirements: ModelRequirements
  ): Promise<ModelScore | null> {
    const health = await healthChecker.checkProvider(
      providerId,
      this.getProviderUrl(providerId),
      this.getProviderType(providerId)
    );

    this.healthCache.set(providerId, health);

    // Skip unhealthy providers
    if (health.status === "down") {
      return null;
    }

    let score = 0;
    const reasons: string[] = [];

    // Health score (0-100)
    if (health.status === "healthy") {
      score += 100;
      reasons.push("healthy");
    } else if (health.status === "degraded") {
      score += 50;
      reasons.push("degraded");
    }

    // Latency score (0-50)
    if (requirements.maxLatency && health.latencyMs <= requirements.maxLatency) {
      score += 50;
      reasons.push(`latency ${health.latencyMs}ms <= ${requirements.maxLatency}ms`);
    } else if (!requirements.maxLatency) {
      score += 25; // Default score if no max latency specified
    }

    // Provider preference score (0-30)
    if (requirements.preferredProviders?.includes(providerId)) {
      score += 30;
      reasons.push("preferred provider");
    }

    // Local preference score (0-20)
    if (requirements.preferLocal && this.getProviderType(providerId) === "local") {
      score += 20;
      reasons.push("local provider preferred");
    }

    // Model count score (0-10)
    if (health.modelCount && health.modelCount > 0) {
      score += Math.min(10, health.modelCount);
      reasons.push(`${health.modelCount} models available`);
    }

    // Get default model for provider
    const modelId = this.getDefaultModel(providerId);

    return {
      providerId,
      modelId,
      score,
      health,
      reasons,
    };
  }

  /**
   * Fallback selection when no provider meets requirements
   */
  private fallbackSelection(providers: string[]): { providerId: string; modelId: string } | null {
    // Try to find any healthy provider
    for (const providerId of providers) {
      const health = this.healthCache.get(providerId);
      if (health && health.status !== "down") {
        return {
          providerId,
          modelId: this.getDefaultModel(providerId),
        };
      }
    }

    return null;
  }

  /**
   * Get provider URL
   */
  private getProviderUrl(providerId: string): string {
    switch (providerId) {
      case "ollama":
        return process.env.PAKALON_OLLAMA_URL || "http://localhost:11434";
      case "lmstudio":
        return process.env.PAKALON_LMSTUDIO_URL || "http://localhost:1234";
      case "openrouter":
        return "https://openrouter.ai/api/v1";
      default:
        return "";
    }
  }

  /**
   * Get provider type
   */
  private getProviderType(providerId: string): "local" | "cloud" {
    switch (providerId) {
      case "ollama":
      case "lmstudio":
        return "local";
      case "openrouter":
        return "cloud";
      default:
        return "local";
    }
  }

  /**
   * Get default model for provider
   */
  private getDefaultModel(providerId: string): string {
    switch (providerId) {
      case "ollama":
        return "llama3.2:3b";
      case "lmstudio":
        return "local-model";
      case "openrouter":
        return "anthropic/claude-3.5-sonnet";
      default:
        return "default";
    }
  }
}

// Global instance
export const modelSelector = new ModelSelector();

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Select the best model based on requirements
 */
export async function selectModel(
  requirements?: ModelRequirements,
  options?: ModelSelectionOptions
): Promise<{ providerId: string; modelId: string } | null> {
  return modelSelector.selectModel(requirements, options);
}

/**
 * Get model selector status
 */
export function getModelSelectorStatus(): {
  availableProviders: string[];
  healthyProviders: string[];
} {
  const flags = getFeatureFlags();
  const availableProviders: string[] = [];

  if (flags.localModels) {
    availableProviders.push("ollama", "lmstudio");
  }

  if (flags.cloudProviders) {
    availableProviders.push("openrouter");
  }

  const healthyProviders = healthChecker.getHealthyProviders();

  return {
    availableProviders,
    healthyProviders: healthyProviders.filter((p) => availableProviders.includes(p)),
  };
}
