/**
 * Unified model registry that unions OpenRouter + Ollama + LM Studio.
 * In self-hosted mode only local sources are returned; in cloud mode
 * only OpenRouter is queried.
 */

import { getModels, type ORModel } from "../../models/dynamic-registry";
import { isLMStudioRunning, type LMStudioModel, listLMStudioModels } from "./lmstudio";
import { isOllamaRunning, listOllamaModels, type OllamaModel } from "./ollama";

export type ModelSource = "openrouter" | "ollama" | "lmstudio";

export interface UnifiedModel {
	id: string;
	name: string;
	source: ModelSource;
	provider: string;
	contextLength: number;
	isFree: boolean;
	/** USD per million tokens, when known. */
	pricing: { prompt: number; completion: number };
	raw: ORModel | OllamaModel | LMStudioModel | null;
}

export interface UnifiedRegistry {
	mode: "cloud" | "selfhosted";
	models: UnifiedModel[];
}

function isSelfHosted(): boolean {
	return process.env.PAKALON_MODE === "selfhosted" || process.env.PAKALON_SELF_HOSTED === "1";
}

/** Public re-export so other modules can branch on the runtime mode. */
export const isSelfHostedMode = isSelfHosted;

/** Get a unified list of models available to the current user. */
export async function getUnifiedModels(apiKey?: string): Promise<UnifiedRegistry> {
	const selfhosted = isSelfHosted();
	const out: UnifiedModel[] = [];

	if (selfhosted) {
		if (await isOllamaRunning()) {
			const ollama = await listOllamaModels();
			for (const m of ollama) {
				out.push({
					id: `ollama/${m.name}`,
					name: m.name,
					source: "ollama",
					provider: "ollama",
					contextLength: 4096, // Ollama doesn't expose this via /api/tags; assume 4k
					isFree: true,
					pricing: { prompt: 0, completion: 0 },
					raw: m,
				});
			}
		}
		if (await isLMStudioRunning()) {
			const lms = await listLMStudioModels();
			for (const m of lms) {
				out.push({
					id: `lmstudio/${m.id}`,
					name: m.id,
					source: "lmstudio",
					provider: "lmstudio",
					contextLength: 4096,
					isFree: true,
					pricing: { prompt: 0, completion: 0 },
					raw: m,
				});
			}
		}
		return { mode: "selfhosted", models: out };
	}

	// Cloud mode: OpenRouter only
	const orModels = await getModels(apiKey);
	for (const m of orModels) {
		out.push({
			id: m.id,
			name: m.name ?? m.id,
			source: "openrouter",
			provider: m.provider ?? "openrouter",
			contextLength: m.context_length ?? 4096,
			isFree: m.isFree ?? false,
			pricing: m.pricing ?? { prompt: 0, completion: 0 },
			raw: m,
		});
	}
	return { mode: "cloud", models: out };
}

/**
 * Auto-pick the model with the highest context window and lowest
 * output price (per the requirements §OpenRouter auto-select).
 */
export function pickAutoModel(models: UnifiedModel[]): UnifiedModel | null {
	if (models.length === 0) return null;
	const candidates = [...models];
	candidates.sort((a, b) => {
		// Prefer higher context first
		if (b.contextLength !== a.contextLength) return b.contextLength - a.contextLength;
		// Then lower price
		return a.pricing.completion - b.pricing.completion;
	});
	return candidates[0]!;
}
