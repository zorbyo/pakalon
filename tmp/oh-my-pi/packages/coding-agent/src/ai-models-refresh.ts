/**
 * Daily Model Refresh for Pakalon
 *
 * Automatically fetches the latest models from OpenRouter daily,
 * categorizes them as free/pro, and updates the local model catalog.
 * Ensures newly released models are immediately available.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODELS_CACHE_PATH = path.join(
	process.env.PAKALON_CONFIG_DIR || path.join(process.env.HOME!, ".config", "pakalon"),
	"models-cache.json",
);
const DAILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	contextWindow: number;
	pricing: {
		input: number;
		output: number;
	};
	isFree: boolean;
	capabilities: string[];
	releasedAt: string;
	lastRefreshed: string;
}

export interface ModelsCache {
	lastRefreshed: string;
	models: ModelInfo[];
	freeModels: ModelInfo[];
	proModels: ModelInfo[];
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch latest models from OpenRouter API
 */
export async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
	try {
		logger.info("Fetching latest models from OpenRouter");

		const response = await fetch(OPENROUTER_MODELS_URL, {
			headers: {
				"User-Agent": "pakalon-cli/1.0.0",
				"HTTP-Referer": "https://pakalon.dev",
				"X-Title": "Pakalon CLI",
			},
		});

		if (!response.ok) {
			throw new Error(`OpenRouter API responded with ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();
		if (!data.data || !Array.isArray(data.data)) {
			throw new Error("Invalid response format from OpenRouter");
		}

		// Transform OpenRouter format to our format
		const models: ModelInfo[] = data.data.map((model: Record<string, unknown>) => {
			const id = model.id as string;
			const name = model.name || id;
			const provider = id.split("/")[0] || "unknown";
			const contextWindow = model.context_length || 128000;
			const pricing = model.pricing || {};
			const isFree = id.endsWith(":free") || pricing.input === "0" || pricing.output === "0";

			// Detect capabilities
			const capabilities: string[] = [];
			if (model.supports_tool_use || model.tool_use) capabilities.push("tool-use");
			if (model.supports_vision || model.vision) capabilities.push("vision");
			if (model.supports_reasoning || model.reasoning) capabilities.push("reasoning");
			if (model.supports_images || model.image_generation) capabilities.push("image-generation");

			return {
				id,
				name,
				provider,
				contextWindow,
				pricing: {
					input: parseFloat(pricing.input || "0"),
					output: parseFloat(pricing.output || "0"),
				},
				isFree,
				capabilities,
				releasedAt: new Date().toISOString(),
				lastRefreshed: new Date().toISOString(),
			};
		});

		logger.info("Models fetched successfully", { count: models.length, free: models.filter(m => m.isFree).length });

		return models;
	} catch (error) {
		logger.error("Failed to fetch models from OpenRouter", { error });
		throw error;
	}
}

/**
 * Load models from local cache
 */
export async function loadCachedModels(): Promise<ModelsCache | null> {
	try {
		if (!fs.existsSync(MODELS_CACHE_PATH)) {
			return null;
		}

		const raw = fs.readFileSync(MODELS_CACHE_PATH, "utf-8");
		return JSON.parse(raw) as ModelsCache;
	} catch {
		return null;
	}
}

/**
 * Save models to local cache
 */
export async function saveModelsToCache(models: ModelInfo[]): Promise<void> {
	try {
		const cache: ModelsCache = {
			lastRefreshed: new Date().toISOString(),
			models,
			freeModels: models.filter(m => m.isFree),
			proModels: models.filter(m => !m.isFree),
		};

		fs.mkdirSync(path.dirname(MODELS_CACHE_PATH), { recursive: true });
		fs.writeFileSync(MODELS_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");

		logger.info("Models cache saved", {
			path: MODELS_CACHE_PATH,
			total: models.length,
			free: cache.freeModels.length,
			pro: cache.proModels.length,
		});
	} catch (error) {
		logger.error("Failed to save models cache", { error });
	}
}

/**
 * Refresh models from OpenRouter and update cache
 */
export async function refreshModels(force: boolean = false): Promise<ModelsCache> {
	try {
		// Check if we need to refresh
		if (!force) {
			const cached = await loadCachedModels();
			if (cached) {
				const lastRefreshed = new Date(cached.lastRefreshed);
				const now = new Date();
				const hoursSinceRefresh = (now.getTime() - lastRefreshed.getTime()) / (1000 * 60 * 60);

				// Only refresh if more than 24 hours have passed
				if (hoursSinceRefresh < 24) {
					logger.debug("Using cached models", { hoursSinceRefresh: hoursSinceRefresh.toFixed(2) });
					return cached;
				}
			}
		}

		// Fetch fresh models
		const models = await fetchOpenRouterModels();
		await saveModelsToCache(models);

		return {
			lastRefreshed: new Date().toISOString(),
			models,
			freeModels: models.filter(m => m.isFree),
			proModels: models.filter(m => !m.isFree),
		};
	} catch (error) {
		logger.error("Model refresh failed", { error });

		// Fall back to cache if available
		const cached = await loadCachedModels();
		if (cached) {
			return cached;
		}

		// Return empty cache
		return {
			lastRefreshed: new Date().toISOString(),
			models: [],
			freeModels: [],
			proModels: [],
		};
	}
}

/**
 * Get models for a specific user plan (free or pro)
 */
export async function getModelsForPlan(plan: "free" | "pro"): Promise<ModelInfo[]> {
	try {
		const cache = await refreshModels();
		return plan === "free" ? cache.freeModels : cache.models;
	} catch {
		return [];
	}
}

/**
 * Start daily auto-refresh scheduler
 * Call this on app startup
 */
export function startDailyModelRefresh(onRefresh?: (models: ModelInfo[]) => void): void {
	if (refreshTimer) {
		logger.debug("Daily model refresh already running");
		return;
	}

	logger.info("Starting daily model refresh scheduler", { interval: "24h" });

	// Do initial refresh
	refreshModels()
		.then(models => {
			if (onRefresh) onRefresh(models);
		})
		.catch(() => {
			logger.warn("Initial model refresh failed");
		});

	// Schedule daily refresh
	refreshTimer = setInterval(() => {
		refreshModels()
			.then(models => {
				if (onRefresh) onRefresh(models);
			})
			.catch(error => {
				logger.error("Scheduled model refresh failed", { error });
			});
	}, DAILY_REFRESH_INTERVAL_MS);
}

/**
 * Stop daily auto-refresh scheduler
 * Call this on app shutdown
 */
export function stopDailyModelRefresh(): void {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
		logger.info("Daily model refresh scheduler stopped");
	}
}

/**
 * Manually trigger a model refresh (e.g., via /models --refresh)
 */
export async function forceRefreshModels(): Promise<ModelsCache> {
	logger.info("Force refreshing models");
	return refreshModels(true);
}

/**
 * Check if new free models are available and log notification
 */
export async function checkForNewFreeModels(): Promise<ModelInfo[]> {
	try {
		const cache = await loadCachedModels();
		if (!cache) return [];

		const freeModels = cache.freeModels;

		// Find models released in last 24 hours that are free
		const now = new Date();
		const recentFreeModels = freeModels.filter(model => {
			const releasedAt = new Date(model.releasedAt);
			const hoursSinceRelease = (now.getTime() - releasedAt.getTime()) / (1000 * 60 * 60);
			return hoursSinceRelease < 24 && model.isFree;
		});

		if (recentFreeModels.length > 0) {
			logger.info("New free models detected", {
				count: recentFreeModels.length,
				models: recentFreeModels.map(m => m.id),
			});
		}

		return recentFreeModels;
	} catch {
		return [];
	}
}

export type { ModelInfo, ModelsCache };
