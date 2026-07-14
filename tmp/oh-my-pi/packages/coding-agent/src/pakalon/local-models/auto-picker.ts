/**
 * Auto-picker for Pakalon's "auto" model selection.
 * Picks the model with the largest context window and lowest output price
 * from the unified (OpenRouter + local) registry.
 */
import { getUnifiedModels, pickAutoModel, type UnifiedModel } from "./registry";

export interface AutoPickResult {
	model: UnifiedModel;
	reason: string;
}

/**
 * Resolve the model to use when `--model auto` is set. Returns the model
 * (or null if none available) plus a human-readable reason.
 */
export async function pickAuto(apiKey?: string): Promise<AutoPickResult | null> {
	const registry = await getUnifiedModels(apiKey);
	const model = pickAutoModel(registry.models);
	if (!model) return null;
	return {
		model,
		reason: `largest context (${model.contextLength}) with lowest $/M output ($${model.pricing.completion.toFixed(2)}/M)`,
	};
}
