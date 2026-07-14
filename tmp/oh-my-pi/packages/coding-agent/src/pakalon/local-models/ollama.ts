/**
 * Ollama detection and model listing for self-hosted Pakalon mode.
 * Connects to the local Ollama daemon on `http://localhost:11434`.
 */
import { logger } from "@oh-my-pi/pi-utils";

export interface OllamaModel {
	name: string;
	size: number;
	modifiedAt: string;
	digest: string;
	details: {
		format: string;
		family: string;
		parameterSize: string;
		quantizationLevel: string;
	};
}

export interface OllamaTagsResponse {
	models: OllamaModel[];
}

const DEFAULT_BASE = "http://localhost:11434";

/** Detect whether Ollama is reachable on the local machine. */
export async function isOllamaRunning(baseUrl: string = DEFAULT_BASE): Promise<boolean> {
	try {
		const resp = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(2_000) });
		return resp.ok;
	} catch {
		return false;
	}
}

/** List locally-available Ollama models. */
export async function listOllamaModels(baseUrl: string = DEFAULT_BASE): Promise<OllamaModel[]> {
	try {
		const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
		if (!resp.ok) return [];
		const data = (await resp.json()) as OllamaTagsResponse;
		return data.models ?? [];
	} catch (err) {
		logger.debug("Ollama model listing failed", { err });
		return [];
	}
}

/** Resolve the base URL from env or the default. */
export function getOllamaBaseUrl(): string {
	return process.env.OLLAMA_HOST ?? DEFAULT_BASE;
}
