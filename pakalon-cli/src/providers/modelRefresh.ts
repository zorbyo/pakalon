/**
 * Dynamic Model Refreshing for pakalon-cli
 *
 * Automatically fetches and updates available models from providers.
 * Supports dynamic scaling and refreshing of models daily.
 */

import { ProviderRegistry, createProviderClient, type ProviderName } from "./index.js";
import logger from "@/utils/logger.js";

// ============================================================================
// Types
// ============================================================================

export type ModelInfo = {
  id: string;
  name: string;
  provider: ProviderName;
  isFree: boolean;
  contextLength?: number;
  pricing?: {
    prompt: number;
    completion: number;
  };
  lastUpdated: Date;
};

export type ModelRefreshConfig = {
  /** Refresh interval in milliseconds (default: 24 hours) */
  refreshIntervalMs: number;
  /** Providers to refresh from */
  providers: ProviderName[];
  /** Whether to auto-refresh on startup */
  autoRefreshOnStartup: boolean;
};

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_REFRESH_CONFIG: ModelRefreshConfig = {
  refreshIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
  providers: ["openrouter"],
  autoRefreshOnStartup: true,
};

// ============================================================================
// Module State
// ============================================================================

let refreshConfig: ModelRefreshConfig = { ...DEFAULT_REFRESH_CONFIG };
let lastRefreshTime: Date | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let cachedModels: Map<ProviderName, ModelInfo[]> = new Map();

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configure the dynamic model refreshing system
 */
export function configureModelRefresh(config: Partial<ModelRefreshConfig>): void {
  refreshConfig = {
    ...refreshConfig,
    ...config,
  };
}

/**
 * Get the current refresh configuration
 */
export function getRefreshConfig(): ModelRefreshConfig {
  return { ...refreshConfig };
}

// ============================================================================
// Model Fetching
// ============================================================================

/**
 * Fetch models from OpenRouter with metadata
 */
async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  try {
    const client = createProviderClient("openrouter");
    const modelIds = await client.listModels();

    const models: ModelInfo[] = modelIds.map((id) => ({
      id,
      name: id,
      provider: "openrouter" as ProviderName,
      isFree: id.endsWith(":free"),
      lastUpdated: new Date(),
    }));

    logger.info(`[ModelRefresh] Fetched ${models.length} models from OpenRouter`);
    return models;
  } catch (error) {
    logger.error(`[ModelRefresh] Failed to fetch OpenRouter models: ${error}`);
    return [];
  }
}

/**
 * Fetch models from a specific provider
 */
async function fetchModelsForProvider(
  provider: ProviderName
): Promise<ModelInfo[]> {
  switch (provider) {
    case "openrouter":
      return fetchOpenRouterModels();
    // Add other providers as needed
    default:
      logger.warn(`[ModelRefresh] Provider ${provider} not supported for model refresh`);
      return [];
  }
}

/**
 * Fetch all models from all configured providers
 */
export async function refreshModels(): Promise<Map<ProviderName, ModelInfo[]>> {
  logger.info("[ModelRefresh] Starting model refresh");

  const newCachedModels = new Map<ProviderName, ModelInfo[]>();

  for (const provider of refreshConfig.providers) {
    const models = await fetchModelsForProvider(provider);
    newCachedModels.set(provider, models);
  }

  cachedModels = newCachedModels;
  lastRefreshTime = new Date();

  logger.info("[ModelRefresh] Model refresh completed");
  return cachedModels;
}

// ============================================================================
// Auto-Refresh
// ============================================================================

/**
 * Start automatic model refreshing
 */
export function startAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(async () => {
    await refreshModels();
  }, refreshConfig.refreshIntervalMs);

  logger.info(
    `[ModelRefresh] Auto-refresh started (interval: ${refreshConfig.refreshIntervalMs}ms)`
  );
}

/**
 * Stop automatic model refreshing
 */
export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  logger.info("[ModelRefresh] Auto-refresh stopped");
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all cached models for a provider
 */
export function getCachedModels(provider: ProviderName): ModelInfo[] {
  return cachedModels.get(provider) ?? [];
}

/**
 * Get all cached models across all providers
 */
export function getAllCachedModels(): ModelInfo[] {
  const allModels: ModelInfo[] = [];
  for (const models of cachedModels.values()) {
    allModels.push(...models);
  }
  return allModels;
}

/**
 * Get free models only
 */
export function getFreeModels(provider?: ProviderName): ModelInfo[] {
  const models = provider ? getCachedModels(provider) : getAllCachedModels();
  return models.filter((m) => m.isFree);
}

/**
 * Get pro models only (non-free)
 */
export function getProModels(provider?: ProviderName): ModelInfo[] {
  const models = provider ? getCachedModels(provider) : getAllCachedModels();
  return models.filter((m) => !m.isFree);
}

/**
 * Search models by query
 */
export function searchModels(
  query: string,
  provider?: ProviderName
): ModelInfo[] {
  const models = provider ? getCachedModels(provider) : getAllCachedModels();
  const lowerQuery = query.toLowerCase();
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(lowerQuery) ||
      m.name.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get last refresh time
 */
export function getLastRefreshTime(): Date | null {
  return lastRefreshTime;
}

/**
 * Check if models need refresh
 */
export function needsRefresh(): boolean {
  if (!lastRefreshTime) return true;
  const elapsed = Date.now() - lastRefreshTime.getTime();
  return elapsed > refreshConfig.refreshIntervalMs;
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the model refresh system
 */
export async function initModelRefresh(): Promise<void> {
  if (refreshConfig.autoRefreshOnStartup) {
    await refreshModels();
  }
  startAutoRefresh();
}

/**
 * Shutdown the model refresh system
 */
export function shutdownModelRefresh(): void {
  stopAutoRefresh();
}
