/**
 * Helper to fetch and display OpenRouter models in the slash command registry.
 */

import { getUserTier } from "../../auth/openrouter-auth";
import { fetchOpenRouterModels } from "../../models/dynamic-registry";
import { filterByTier } from "../../models/tier-filter";
import { getUnifiedModels } from "../../pakalon/local-models/registry";

export async function listOpenRouterModels(): Promise<string> {
	const tier = getUserTier();
	if (tier === "unknown") {
		return "Not authenticated. Please login first.";
	}
	const models = await fetchOpenRouterModels();
	const filtered = filterByTier(models, tier);
	if (filtered.length === 0) {
		return "No models available for your tier.";
	}
	return filtered
		.map((m: import("../../models/dynamic-registry").ORModel) => {
			const ctx = m.context_length ?? 0;
			return `  ${m.id} (${ctx}k) ${m.isFree ? "[FREE]" : ""}`;
		})
		.join("\n");
}

export function selectBestModel(models: import("../../models/dynamic-registry").ORModel[]) {
	return selectAutoFromOpenRouter(models);
}

// Local re-export — kept as a separate function to avoid an extra import in
// the slash registry.
function selectAutoFromOpenRouter(models: import("../../models/dynamic-registry").ORModel[]) {
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
 * Pakalon variant: union the OpenRouter registry with local Ollama / LM
 * Studio models. Used by the `/models` slash command. Free users see
 * only `:free` models + any local model; Pro users see all.
 */
export async function listUnifiedModels(): Promise<string> {
	const auth = await import("../../auth/openrouter-auth");
	const isFree = (auth.loadAuth()?.tier ?? "free") !== "pro";
	const unified = await getUnifiedModels();
	const visible = isFree ? unified.models.filter(m => m.isFree) : unified.models;
	if (visible.length === 0) return "No models available. Run /login or start Ollama/LM Studio.";
	return [
		`Mode: ${unified.mode} | ${visible.length} models`,
		"",
		...visible
			.slice(0, 80)
			.map(m => `  ${m.id}  (ctx=${m.contextLength}, $/M-out=${m.pricing.completion.toFixed(2)}, free=${m.isFree})`),
	].join("\n");
}
