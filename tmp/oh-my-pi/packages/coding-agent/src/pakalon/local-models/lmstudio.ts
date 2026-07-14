/**
 * LM Studio detection and model listing for self-hosted Pakalon mode.
 * LM Studio exposes an OpenAI-compatible API on `http://localhost:1234`.
 */
import { logger } from "@oh-my-pi/pi-utils";

export interface LMStudioModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
}

const DEFAULT_BASE = "http://localhost:1234";

/** Detect whether LM Studio's local server is reachable. */
export async function isLMStudioRunning(baseUrl: string = DEFAULT_BASE): Promise<boolean> {
	try {
		const resp = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2_000) });
		return resp.ok;
	} catch {
		return false;
	}
}

/** List models exposed by LM Studio. */
export async function listLMStudioModels(baseUrl: string = DEFAULT_BASE): Promise<LMStudioModel[]> {
	try {
		const resp = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5_000) });
		if (!resp.ok) return [];
		const data = (await resp.json()) as { data: LMStudioModel[] };
		return data.data ?? [];
	} catch (err) {
		logger.debug("LM Studio model listing failed", { err });
		return [];
	}
}

/** Resolve the base URL from env or the default. */
export function getLMStudioBaseUrl(): string {
	return process.env.LMSTUDIO_HOST ?? DEFAULT_BASE;
}
