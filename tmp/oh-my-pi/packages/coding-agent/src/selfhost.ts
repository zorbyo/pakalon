/**
 * Self-hosted mode for Pakalon.
 * Detects local LLM providers (Ollama, LM Studio), manages offline configuration,
 * and provides the self-hosted path that skips cloud auth/billing.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// =============================================================================
// Types
// =============================================================================

export interface LocalProvider {
	name: string;
	type: "ollama" | "lmstudio" | "custom";
	baseUrl: string;
	available: boolean;
	models: LocalModel[];
}

export interface LocalModel {
	id: string;
	name: string;
	provider: string;
	contextLength: number;
	parameterSize?: string;
}

export interface SelfHostConfig {
	enabled: boolean;
	forced: boolean; // --selfhost flag
	detectedProviders: LocalProvider[];
	defaultProvider?: string;
	defaultModel?: string;
}

// =============================================================================
// Detection
// =============================================================================

const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const LMSTUDIO_DEFAULT_URL = "http://localhost:1234";

/**
 * Check if self-hosted mode is forced via flag or environment.
 */
export function isSelfHostForced(): boolean {
	if (process.env.PAKALON_SELFHOST === "1") return true;
	// Check for selfhost config file
	const configPath = path.join(os.homedir(), ".config", "pakalon", "selfhost.json");
	try {
		return fs.existsSync(configPath);
	} catch {
		return false;
	}
}

/**
 * Detect if Ollama is running at the given URL.
 */
async function detectOllama(baseUrl: string): Promise<LocalProvider | null> {
	try {
		const resp = await fetch(`${baseUrl}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { models?: Array<{ name: string; size: number }> };
		const models: LocalModel[] = (data.models || []).map(m => ({
			id: `ollama:${m.name}`,
			name: m.name,
			provider: "ollama",
			contextLength: 4096, // Ollama doesn't report context length in /api/tags
			parameterSize: formatSize(m.size),
		}));
		return {
			name: "Ollama",
			type: "ollama",
			baseUrl,
			available: true,
			models,
		};
	} catch {
		return null;
	}
}

/**
 * Detect if LM Studio is running at the given URL.
 */
async function detectLMStudio(baseUrl: string): Promise<LocalProvider | null> {
	try {
		const resp = await fetch(`${baseUrl}/v1/models`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { data?: Array<{ id: string; object: string }> };
		const models: LocalModel[] = (data.data || []).map(m => ({
			id: `lmstudio:${m.id}`,
			name: m.id,
			provider: "lmstudio",
			contextLength: 4096,
		}));
		return {
			name: "LM Studio",
			type: "lmstudio",
			baseUrl,
			available: true,
			models,
		};
	} catch {
		return null;
	}
}

/**
 * Detect all available local LLM providers.
 */
export async function detectLocalProviders(): Promise<LocalProvider[]> {
	const ollamaUrl = process.env.OLLAMA_HOST || OLLAMA_DEFAULT_URL;
	const lmstudioUrl = process.env.LMSTUDIO_HOST || LMSTUDIO_DEFAULT_URL;

	const [ollama, lmstudio] = await Promise.all([detectOllama(ollamaUrl), detectLMStudio(lmstudioUrl)]);

	const providers: LocalProvider[] = [];
	if (ollama) providers.push(ollama);
	if (lmstudio) providers.push(lmstudio);

	logger.debug("Local provider detection complete", {
		ollama: ollama?.available ?? false,
		lmstudio: lmstudio?.available ?? false,
		totalModels: providers.reduce((sum, p) => sum + p.models.length, 0),
	});

	return providers;
}

/**
 * Get the full self-host configuration.
 */
export async function getSelfHostConfig(): Promise<SelfHostConfig> {
	const forced = isSelfHostForced();
	const providers = await detectLocalProviders();

	return {
		enabled: forced || providers.length > 0,
		forced,
		detectedProviders: providers,
		defaultProvider: providers[0]?.type,
		defaultModel: providers[0]?.models[0]?.id,
	};
}

// =============================================================================
// Config Persistence
// =============================================================================

function getSelfHostConfigPath(): string {
	return path.join(os.homedir(), ".config", "pakalon", "selfhost.json");
}

/**
 * Save self-host configuration to disk.
 */
export async function saveSelfHostConfig(config: SelfHostConfig): Promise<void> {
	const configPath = getSelfHostConfigPath();
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	await Bun.write(configPath, JSON.stringify(config, null, 2));
}

/**
 * Load self-host configuration from disk.
 */
export async function loadSelfHostConfig(): Promise<SelfHostConfig | null> {
	const configPath = getSelfHostConfigPath();
	try {
		return await Bun.file(configPath).json();
	} catch {
		return null;
	}
}

// =============================================================================
// Provider Health
// =============================================================================

export interface ProviderHealth {
	provider: string;
	healthy: boolean;
	latencyMs: number;
	modelCount: number;
	error?: string;
}

/**
 * Check health of all detected providers.
 */
export async function checkProviderHealth(): Promise<ProviderHealth[]> {
	const providers = await detectLocalProviders();
	const results: ProviderHealth[] = [];

	for (const provider of providers) {
		const start = Date.now();
		try {
			const url = provider.type === "ollama" ? `${provider.baseUrl}/api/tags` : `${provider.baseUrl}/v1/models`;
			const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
			results.push({
				provider: provider.name,
				healthy: resp.ok,
				latencyMs: Date.now() - start,
				modelCount: provider.models.length,
			});
		} catch (err) {
			results.push({
				provider: provider.name,
				healthy: false,
				latencyMs: Date.now() - start,
				modelCount: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return results;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatSize(bytes: number): string {
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Format provider status for display.
 */
export function formatProviderStatus(providers: LocalProvider[]): string {
	if (providers.length === 0) {
		return "No local providers detected. Start Ollama or LM Studio.";
	}
	const lines: string[] = [];
	for (const p of providers) {
		lines.push(`  ${p.name} (${p.baseUrl}) — ${p.models.length} model(s)`);
		for (const m of p.models) {
			lines.push(`    - ${m.name}${m.parameterSize ? ` (${m.parameterSize})` : ""}`);
		}
	}
	return lines.join("\n");
}

/**
 * Format the default local model config for offline mode.
 */
export function getDefaultLocalModelConfig(): { provider: string; baseUrl: string; model: string } | null {
	const ollamaUrl = process.env.OLLAMA_HOST || OLLAMA_DEFAULT_URL;

	// Priority: Ollama > LM Studio
	return {
		provider: "ollama",
		baseUrl: ollamaUrl,
		model: "llama3",
	};
}
