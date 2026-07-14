/**
 * Tier-based model filtering for Pakalon.
 */

import type { UnifiedModel } from "../pakalon/local-models/registry";
import type { ORModel } from "./dynamic-registry";

export type UserTier = "free" | "pro" | "unknown";

/**
 * Filter models by user tier.
 * Free users see only :free models. Pro users see all.
 */
export function filterByTier(models: ORModel[], tier: UserTier): ORModel[] {
	if (tier === "free") {
		return models.filter(m => m.isFree);
	}
	return models;
}

/**
 * Default to "auto": pick highest context window, lowest cost model.
 */
export function selectAutoModel(models: ORModel[]): ORModel | null {
	if (models.length === 0) return null;
	return (
		models
			.filter(m => (m.context_length ?? 0) > 0)
			.sort(
				(a, b) =>
					(b.context_length ?? 0) - (a.context_length ?? 0) || (a.pricing?.prompt ?? 0) - (b.pricing?.prompt ?? 0),
			)[0] ?? null
	);
}

/**
 * Unified (OpenRouter + local) variant of `selectAutoModel`. Used by
 * the Pakalon `/model-auto` slash command.
 */
export function selectAutoUnifiedModel(models: UnifiedModel[]): UnifiedModel | null {
	if (models.length === 0) return null;
	const sorted = [...models].sort((a, b) => {
		// Prefer higher context first
		if (b.contextLength !== a.contextLength) return b.contextLength - a.contextLength;
		// Then lower output price
		return a.pricing.completion - b.pricing.completion;
	});
	return sorted[0] ?? null;
}
