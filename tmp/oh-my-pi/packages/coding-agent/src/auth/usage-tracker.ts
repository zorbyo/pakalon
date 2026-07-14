/**
 * Usage tracking for Pakalon.
 * Logs tokens, prompts, and code changes per session with per-model cost breakdown.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { deductCredits, getModelPricing } from "./billing";

const USAGE_DIR = path.join(os.homedir(), ".pakalon", "usage");

export interface UsageEntry {
	timestamp: string;
	sessionId: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	webSearchCalls: number;
	costUsd: number;
	/** 10 % platform fee on top of `costUsd`. Defaults to 0 if missing. */
	platformFeeUsd?: number;
	prompt?: string;
	filesModified?: string[];
	linesChanged?: number;
}

export interface UsageSummary {
	totalTokens: number;
	totalCost: number;
	totalPrompts: number;
	totalWebSearches: number;
	byModel: Record<string, { tokens: number; cost: number; calls: number }>;
	entries: UsageEntry[];
}

function ensureDir(): void {
	if (!fs.existsSync(USAGE_DIR)) {
		fs.mkdirSync(USAGE_DIR, { recursive: true });
	}
}

function usageFile(): string {
	const date = new Date().toISOString().slice(0, 7); // YYYY-MM
	return path.join(USAGE_DIR, `${date}.jsonl`);
}

/**
 * Log a single usage entry.
 *
 * Per the post-paid billing model in `requirments/CLI-req.md §Usage`:
 * the user pays the underlying model cost + 10 % platform fee.
 * We compute the raw cost, apply the fee, and deduct the resulting
 * total from the user's credits. The 10 % is recorded as a separate
 * `platformFeeUsd` field for transparency / invoicing.
 */
export function logUsage(entry: Omit<UsageEntry, "timestamp" | "costUsd" | "platformFeeUsd">): void {
	ensureDir();
	const pricing = getModelPricing(entry.modelId);
	const inputCost = (entry.inputTokens / 1_000_000) * pricing.input;
	const outputCost = (entry.outputTokens / 1_000_000) * pricing.output;
	const webSearchCost = entry.webSearchCalls * 0.01; // $0.01 per web search
	const costUsd = inputCost + outputCost + webSearchCost;
	const platformFeeUsd = costUsd * 0.1; // 10% platform fee per the post-paid model.

	const full: UsageEntry & { platformFeeUsd?: number } = {
		...entry,
		timestamp: new Date().toISOString(),
		costUsd,
		platformFeeUsd,
	};
	const line = `${JSON.stringify(full)}\n`;
	fs.appendFileSync(usageFile(), line);

	// Deduct the total (cost + platform fee) from credits.
	const totalCharge = costUsd + platformFeeUsd;
	if (totalCharge > 0) {
		deductCredits(totalCharge);
	}

	logger.debug("Usage logged", {
		model: entry.modelId,
		tokens: entry.inputTokens + entry.outputTokens,
		cost: costUsd.toFixed(4),
		fee: platformFeeUsd.toFixed(4),
	});
}

/**
 * Get usage summary for the current month.
 */
export function getMonthlyUsage(): UsageSummary {
	try {
		const lines = fs.readFileSync(usageFile(), "utf-8").trim().split("\n").filter(Boolean);
		const entries = lines.map(l => JSON.parse(l) as UsageEntry);

		const byModel: Record<string, { tokens: number; cost: number; calls: number }> = {};
		for (const entry of entries) {
			const key = entry.modelId;
			if (!byModel[key]) {
				byModel[key] = { tokens: 0, cost: 0, calls: 0 };
			}
			byModel[key].tokens += entry.inputTokens + entry.outputTokens;
			byModel[key].cost += entry.costUsd;
			byModel[key].calls += 1;
		}

		return {
			entries,
			totalTokens: entries.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0),
			totalCost: entries.reduce((s, e) => s + e.costUsd, 0),
			totalPrompts: entries.length,
			totalWebSearches: entries.reduce((s, e) => s + e.webSearchCalls, 0),
			byModel,
		};
	} catch {
		return {
			totalTokens: 0,
			totalCost: 0,
			totalPrompts: 0,
			totalWebSearches: 0,
			byModel: {},
			entries: [],
		};
	}
}

/**
 * Get usage for a specific session.
 */
export function getSessionUsage(sessionId: string): UsageSummary {
	const monthly = getMonthlyUsage();
	const entries = monthly.entries.filter(e => e.sessionId === sessionId);
	const byModel: Record<string, { tokens: number; cost: number; calls: number }> = {};

	for (const entry of entries) {
		const key = entry.modelId;
		if (!byModel[key]) {
			byModel[key] = { tokens: 0, cost: 0, calls: 0 };
		}
		byModel[key].tokens += entry.inputTokens + entry.outputTokens;
		byModel[key].cost += entry.costUsd;
		byModel[key].calls += 1;
	}

	return {
		entries,
		totalTokens: entries.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0),
		totalCost: entries.reduce((s, e) => s + e.costUsd, 0),
		totalPrompts: entries.length,
		totalWebSearches: entries.reduce((s, e) => s + e.webSearchCalls, 0),
		byModel,
	};
}

/**
 * Format usage summary for display.
 */
export function formatUsageSummary(summary: UsageSummary): string {
	const lines = [
		"Usage Summary",
		"═══════════════════════════════════════",
		`Total Tokens: ${summary.totalTokens.toLocaleString()}`,
		`Total Cost: $${summary.totalCost.toFixed(4)}`,
		`Total Prompts: ${summary.totalPrompts}`,
		`Web Search Calls: ${summary.totalWebSearches}`,
		"",
		"By Model:",
	];

	for (const [model, stats] of Object.entries(summary.byModel)) {
		lines.push(
			`  ${model}: ${stats.tokens.toLocaleString()} tokens, $${stats.cost.toFixed(4)} (${stats.calls} calls)`,
		);
	}

	return lines.join("\n");
}

/**
 * Intercept LLM calls to log usage with proper token counting.
 */
export function withUsageTracking<
	T extends (...args: never[]) => Promise<{ usage?: { promptTokens?: number; completionTokens?: number } }>,
>(sessionId: string, modelId: string, fn: T): T {
	return (async (...args: never[]) => {
		const result = await fn(...args);
		if (result.usage) {
			logUsage({
				sessionId,
				modelId,
				inputTokens: result.usage.promptTokens ?? 0,
				outputTokens: result.usage.completionTokens ?? 0,
				webSearchCalls: 0,
			});
		}
		return result;
	}) as T;
}
