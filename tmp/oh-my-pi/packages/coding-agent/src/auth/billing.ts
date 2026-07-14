/**
 * Billing integration for Pakalon.
 * Handles free/pro tiering, credits, Polar payment gateway, and post-paid billing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { loadAuth, saveAuth } from "./openrouter-auth";

export interface BillingResult {
	totalCost: number;
	platformFee: number;
	grandTotal: number;
	deposit: number;
	modelBreakdown: ModelUsage[];
}

export interface ModelUsage {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
}

export interface PolarCheckout {
	checkoutId: string;
	checkoutUrl: string;
	status: "pending" | "completed" | "expired";
}

export interface BillItem {
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	inputPricePerMillion: number;
	outputPricePerMillion: number;
}

const PLATFORM_FEE_PERCENT = 0.1;
const PRO_DEPOSIT = 2.0;
const POLAR_API_BASE = "https://api.polar.sh/v1";

// Model pricing (USD per million tokens) - will be refreshed from OpenRouter
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
	"anthropic/claude-sonnet-4": { input: 3, output: 15 },
	"anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
	"openai/gpt-4o": { input: 2.5, output: 10 },
	"openai/gpt-4-turbo": { input: 10, output: 30 },
	"google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
	"meta-llama/llama-3.1-405b": { input: 2, output: 6 },
};

/**
 * Calculate monthly billing based on usage.
 */
export function calculateBilling(items: BillItem[]): BillingResult {
	const modelBreakdown: ModelUsage[] = items.map(item => {
		const inputCost = (item.inputTokens / 1_000_000) * item.inputPricePerMillion;
		const outputCost = (item.outputTokens / 1_000_000) * item.outputPricePerMillion;
		return {
			modelId: item.modelId,
			inputTokens: item.inputTokens,
			outputTokens: item.outputTokens,
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	});

	const totalCost = modelBreakdown.reduce((sum, m) => sum + m.totalCost, 0);
	const platformFee = totalCost * PLATFORM_FEE_PERCENT;
	const grandTotal = totalCost + platformFee + PRO_DEPOSIT;

	return { totalCost, platformFee, grandTotal, deposit: PRO_DEPOSIT, modelBreakdown };
}

/**
 * Get pricing for a model.
 */
export function getModelPricing(modelId: string): { input: number; output: number } {
	return MODEL_PRICING[modelId] ?? { input: 0, output: 0 };
}

/**
 * Check if the current user can use a pro model.
 */
export function canUseProModels(): boolean {
	const auth = loadAuth();
	if (!auth) return false;
	return auth.tier === "pro";
}

/**
 * Check if a model is free (ends with :free suffix).
 */
export function isFreeModel(modelId: string): boolean {
	return modelId.endsWith(":free");
}

/**
 * Check if the user has enough credits to continue.
 */
export function hasEnoughCredits(requiredCredits: number = 0): boolean {
	const auth = loadAuth();
	if (!auth) return false;
	if (auth.tier === "pro") return true;
	return auth.creditsRemaining > requiredCredits;
}

/**
 * Deduct credits after usage.
 */
export function deductCredits(amount: number): void {
	const auth = loadAuth();
	if (!auth) return;
	auth.creditsRemaining = Math.max(0, auth.creditsRemaining - amount);
	auth.lastChecked = new Date().toISOString();
	saveAuth(auth);
}

/**
 * Create a Polar checkout session for Pro upgrade.
 * Returns checkout URL for user to complete payment.
 */
export async function createPolarCheckout(userEmail: string): Promise<PolarCheckout | null> {
	try {
		const productId = process.env.POLAR_PRODUCT_ID ?? "";
		const apiKey = process.env.POLAR_API_KEY ?? "";

		if (!productId || !apiKey) {
			logger.warn("Polar not configured, using mock checkout");
			return {
				checkoutId: `mock-${Date.now()}`,
				checkoutUrl: `https://polar.sh/checkout/mock?email=${encodeURIComponent(userEmail)}`,
				status: "pending",
			};
		}

		const response = await fetch(`${POLAR_API_BASE}/checkouts/custom`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				product_id: productId,
				customer_email: userEmail,
				success_url: "https://pakalon.dev/billing/success",
				cancel_url: "https://pakalon.dev/billing/cancel",
			}),
		});

		if (!response.ok) {
			logger.error("Polar checkout creation failed", { status: response.status });
			return null;
		}

		const data = (await response.json()) as { id: string; url: string };
		return {
			checkoutId: data.id,
			checkoutUrl: data.url,
			status: "pending",
		};
	} catch (err) {
		logger.error("Polar checkout error", { err });
		return null;
	}
}

/**
 * Verify Polar payment webhook (for backend use).
 */
export function verifyPolarWebhook(payload: string, signature: string): boolean {
	const webhookSecret = process.env.POLAR_WEBHOOK_SECRET ?? "";
	if (!webhookSecret) {
		logger.warn("Polar webhook secret not configured");
		return false;
	}

	// Simple HMAC verification
	const crypto = require("node:crypto");
	const expected = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");
	return expected === signature;
}

/**
 * Upgrade user to Pro tier after successful payment.
 */
export function upgradeToPro(_apiKey: string): void {
	const auth = loadAuth();
	if (!auth) return;
	auth.tier = "pro";
	auth.creditsRemaining = Infinity;
	auth.lastChecked = new Date().toISOString();
	saveAuth(auth);
	logger.info("User upgraded to Pro tier", { userId: auth.userId });
}

/**
 * Get billing summary for display.
 */
export function getBillingSummary(): string {
	const auth = loadAuth();
	if (!auth) return "Not authenticated. Run /login to sign in.";

	const tier = auth.tier === "pro" ? "Pro" : "Free";
	const credits = auth.tier === "pro" ? "Unlimited" : `$${auth.creditsRemaining.toFixed(2)}`;
	const usage = getMonthlyUsageSummary();

	return [
		`Tier: ${tier}`,
		`Credits: ${credits}`,
		`Last checked: ${auth.lastChecked}`,
		"",
		"Monthly Usage:",
		`  Total tokens: ${usage.totalTokens.toLocaleString()}`,
		`  Total cost: $${usage.totalCost.toFixed(2)}`,
	].join("\n");
}

/**
 * Get monthly usage summary from usage tracker.
 */
function getMonthlyUsageSummary(): { totalTokens: number; totalCost: number } {
	try {
		const usageDir = path.join(require("node:os").homedir(), ".pakalon", "usage");
		const date = new Date().toISOString().slice(0, 7);
		const usageFile = path.join(usageDir, `${date}.jsonl`);
		const lines = fs.readFileSync(usageFile, "utf-8").trim().split("\n").filter(Boolean);
		const entries = lines.map(l => JSON.parse(l) as { inputTokens: number; outputTokens: number; costUsd: number });
		return {
			totalTokens: entries.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0),
			totalCost: entries.reduce((s, e) => s + e.costUsd, 0),
		};
	} catch {
		return { totalTokens: 0, totalCost: 0 };
	}
}
