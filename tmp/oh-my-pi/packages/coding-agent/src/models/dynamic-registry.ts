/**
 * Dynamic OpenRouter model registry for Pakalon.
 * Fetches and caches the latest models from OpenRouter.
 */
import { logger } from "@oh-my-pi/pi-utils";

export interface ORModel {
	id: string;
	name: string;
	provider: string;
	context_length: number;
	pricing: { prompt: number; completion: number };
	isFree: boolean;
}

let cachedModels: ORModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch models from OpenRouter API.
 */
export async function fetchOpenRouterModels(apiKey?: string): Promise<ORModel[]> {
	try {
		const headers: Record<string, string> = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const resp = await fetch("https://openrouter.ai/api/v1/models", { headers });
		if (!resp.ok) throw new Error(`OpenRouter API error: ${resp.status}`);
		const data = await resp.json();
		const models = (data.data || []).map((m: any) => ({
			id: m.id,
			name: m.name,
			provider: m.id.split("/")[0] || "unknown",
			context_length: m.context_length || 4096,
			pricing: {
				prompt: m.pricing?.prompt || 0,
				completion: m.pricing?.completion || 0,
			},
			isFree: m.id.endsWith(":free") || false,
		}));
		cachedModels = models;
		cacheTimestamp = Date.now();
		return models;
	} catch (err) {
		logger.error("Failed to fetch OpenRouter models", { err });
		return cachedModels || [];
	}
}

/**
 * Get cached models, refreshing if needed.
 */
export async function getModels(apiKey?: string): Promise<ORModel[]> {
	if (cachedModels && Date.now() - cacheTimestamp < CACHE_TTL) {
		return cachedModels;
	}
	return fetchOpenRouterModels(apiKey);
}

/**
 * Sort models by newest first (placeholder, uses id order).
 * In production, OpenRouter returns models in order of release.
 */
export function sortByNewest(models: ORModel[]): ORModel[] {
	return [...models].sort((a, b) => a.id.localeCompare(b.id) * -1);
}
