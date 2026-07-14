/**
 * Tier-aware model listing for the Tanstack adapter.
 *
 * Talks to the same backend the CLI uses, so the web companion
 * and the CLI always see the same model list. The backend
 * `GET /v1/models` endpoint is expected to return OpenRouter's
 * full catalog plus a `tier` marker per model.
 */
import { logger } from "@oh-my-pi/pi-utils";

export type PakalonTier = "free" | "pro" | "unknown";

export interface PakalonModelSummary {
	id: string;
	name: string;
	provider: string;
	contextLength: number;
	tier: PakalonTier;
	pricing: { prompt: number; completion: number };
	createdAt?: string;
}

export interface PakalonChatClientLite {
	apiKey?: string;
	baseUrl: string;
}

/**
 * Fetch the model catalog from the Pakalon backend.
 * In self-hosted mode this proxies to the user's local llm-proxy.
 */
export async function listPakalonModels(
	client: PakalonChatClientLite,
	tier: PakalonTier = "pro",
): Promise<PakalonModelSummary[]> {
	const headers: Record<string, string> = {};
	if (client.apiKey) headers.Authorization = `Bearer ${client.apiKey}`;

	try {
		const resp = await fetch(`${client.baseUrl.replace(/\/$/, "")}/v1/models`, { headers });
		if (!resp.ok) {
			logger.warn("listPakalonModels: backend returned non-OK", { status: resp.status });
			return [];
		}
		const data = (await resp.json()) as { data?: Array<Record<string, unknown>> };
		const all = (data.data ?? []).map(parseModel);
		return sortNewestFirst(filterByTier(all, tier));
	} catch (err) {
		logger.error("listPakalonModels: network failure", { err });
		return [];
	}
}

/**
 * Pick the best model for the user. "Best" = highest context window
 * with the lowest prompt price, broken only by the tier filter.
 */
export function resolveAutoModel(models: PakalonModelSummary[]): PakalonModelSummary | null {
	if (models.length === 0) return null;
	return (
		[...models]
			.filter(m => m.contextLength > 0)
			.sort((a, b) => b.contextLength - a.contextLength || a.pricing.prompt - b.pricing.prompt)[0] ?? null
	);
}

function parseModel(raw: Record<string, unknown>): PakalonModelSummary {
	const id = String(raw.id ?? "");
	return {
		id,
		name: String(raw.name ?? id),
		provider: id.split("/")[0] ?? "unknown",
		contextLength: Number(raw.context_length ?? 0),
		tier: deriveTier(id, raw),
		pricing: {
			prompt: Number((raw.pricing as { prompt?: number })?.prompt ?? 0),
			completion: Number((raw.pricing as { completion?: number })?.completion ?? 0),
		},
		createdAt: raw.created_at ? String(raw.created_at) : undefined,
	};
}

function deriveTier(id: string, raw: Record<string, unknown>): PakalonTier {
	if (typeof raw.tier === "string") return raw.tier as PakalonTier;
	if (id.endsWith(":free")) return "free";
	return "pro";
}

function filterByTier(models: PakalonModelSummary[], tier: PakalonTier): PakalonModelSummary[] {
	if (tier === "pro") return models;
	return models.filter(m => m.tier === "free");
}

function sortNewestFirst(models: PakalonModelSummary[]): PakalonModelSummary[] {
	return [...models].sort((a, b) => {
		if (a.createdAt && b.createdAt) {
			return b.createdAt.localeCompare(a.createdAt);
		}
		return b.id.localeCompare(a.id);
	});
}
