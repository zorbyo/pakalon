/**
 * Billing tier-gate enforcement for Pakalon.
 *
 * Single source of truth for "can this user invoke this model?" — every
 * LLM call site must funnel through `requireAccess()` or `requirePro()`.
 *
 * Per CLI-req.md §569 and code.md §4 / §14:
 *   - Free users may only invoke models whose OpenRouter id ends in `:free`.
 *   - Pro users may invoke any model.
 *   - When the user is logged out (tier === "unknown") the call is rejected.
 */
import { logger } from "@oh-my-pi/pi-utils";
import { canUseProModels as canPro, isFreeModel as isFree } from "../../auth/billing";
import { getUserTier, loadAuth } from "../../auth/openrouter-auth";

// Re-export so existing callers can import everything from `tier-gate`.
export const canUseProModels = canPro;
export const isFreeModel = isFree;

export class PlanLimitError extends Error {
	constructor(
		message: string,
		readonly modelId: string,
		readonly tier: "free" | "pro" | "unknown",
	) {
		super(message);
		this.name = "PlanLimitError";
	}
}

/**
 * Resolve the upgrade URL for Pro plan purchases. Per CLI-req.md §585
 * the payment UI lives on the external pakalon website, so the URL
 * is configured by the user / ops team via `PAKALON_UPGRADE_URL`.
 * The default falls back to the canonical pakalon.dev site; users
 * can override it in `~/.pakalon/settings.local.json` under
 * `pakalon.upgradeUrl` for self-hosted deployments.
 */
export function getUpgradeUrl(opts: { returnTo?: string } = {}): string {
	const fromEnv = process.env.PAKALON_UPGRADE_URL;
	if (fromEnv && fromEnv.length > 0) {
		return appendReturnTo(fromEnv, opts.returnTo);
	}
	try {
		const settings = loadSettingsFile();
		const v = settings["pakalon.upgradeUrl"] ?? settings.pakalon?.upgradeUrl;
		if (typeof v === "string" && v.length > 0) {
			return appendReturnTo(v, opts.returnTo);
		}
	} catch {
		/* ignore — fall through to default */
	}
	return appendReturnTo("https://pakalon.dev/upgrade", opts.returnTo);
}

function appendReturnTo(url: string, returnTo: string | undefined): string {
	if (!returnTo) return url;
	try {
		const u = new URL(url);
		u.searchParams.set("return_to", returnTo);
		return u.toString();
	} catch {
		return `${url}${url.includes("?") ? "&" : "?"}return_to=${encodeURIComponent(returnTo)}`;
	}
}

/** Minimal shape of the per-user settings file we read here. */
function loadSettingsFile(): { "pakalon.upgradeUrl"?: string; pakalon?: { upgradeUrl?: string } } {
	try {
		// Lazy require to avoid a top-level cycle with project-settings.
		// We accept both the legacy `AuthSettings.allowedPermissions` and
		// the new `pakalon.upgradeUrl` shape.
		const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
		const candidates = [`${home}/.pakalon/settings.local.json`, `${home}/.config/pakalon/settings.local.json`];
		for (const f of candidates) {
			// Use dynamic import resolution: try the local FS first.
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const fs = require("node:fs") as typeof import("node:fs");
			if (fs.existsSync(f)) {
				return JSON.parse(fs.readFileSync(f, "utf-8")) as ReturnType<typeof loadSettingsFile>;
			}
		}
	} catch {
		/* ignore */
	}
	return {};
}

/**
 * Throw `PlanLimitError` if the current user is NOT on the Pro plan.
 * Use this when a model id is known to be Pro-only.
 */
export function requirePro(modelId: string): void {
	const tier = getUserTier();
	if (tier === "pro") return;
	logger.warn("tier-gate: blocked pro model", { modelId, tier });
	throw new PlanLimitError(
		`Model ${modelId} requires the Pro plan. Run \`/login\` then \`/upgrade\` (${getUpgradeUrl()}).`,
		modelId,
		tier,
	);
}

/**
 * Throw `PlanLimitError` if the current user cannot invoke `modelId`.
 * - Logged-out users: blocked.
 * - Free users: blocked unless the model id matches the `:free` convention.
 * - Pro users: always allowed.
 */
export function requireAccess(modelId: string): void {
	const tier = getUserTier();
	if (tier === "pro") return;
	if (tier === "free" && isFreeModel(modelId)) return;
	if (tier === "unknown") {
		throw new PlanLimitError(
			`You must /login before invoking ${modelId}. Get a Pro plan at ${getUpgradeUrl()}.`,
			modelId,
			tier,
		);
	}
	// Free user on a non-free model.
	logger.warn("tier-gate: blocked non-free model for free user", { modelId, tier });
	throw new PlanLimitError(
		`Model ${modelId} is not available on the Free plan. Upgrade to Pro at ${getUpgradeUrl()}.`,
		modelId,
		tier,
	);
}

/** Whether the current user is on a free plan. */
export function isFreeUser(): boolean {
	return getUserTier() !== "pro";
}

/** Whether the user has any credits remaining. */
export function hasCredits(): boolean {
	const auth = loadAuth();
	if (!auth) return false;
	if (auth.tier === "pro") return true;
	return (auth.creditsRemaining ?? 0) > 0;
}

/**
 * Filter a list of model ids to those the current user is allowed to invoke.
 * Used by `/models` to render the tier-appropriate list and by the auto-picker.
 */
export function filterModelsForUser<T extends { id: string }>(models: T[]): T[] {
	const tier = getUserTier();
	if (tier === "pro") return models;
	return models.filter(m => isFreeModel(m.id));
}

/**
 * Pick the best model from `candidates` for the current user.
 * Heuristic: largest context window ÷ cost per output token, restricted
 * to models the user can invoke. Falls back to the first candidate
 * (regardless of tier) when no accessible model exists; the caller
 * should then surface an upgrade prompt.
 */
export function pickAutoModel<T extends { id: string; contextWindow?: number; costPerOutputToken?: number }>(
	candidates: T[],
): T | null {
	const accessible = filterModelsForUser(candidates);
	const pool = accessible.length > 0 ? accessible : candidates;
	if (pool.length === 0) return null;
	const scored = [...pool].sort((a, b) => {
		const aCtx = a.contextWindow ?? 0;
		const bCtx = b.contextWindow ?? 0;
		const aCost = a.costPerOutputToken ?? Number.POSITIVE_INFINITY;
		const bCost = b.costPerOutputToken ?? Number.POSITIVE_INFINITY;
		// Higher context AND lower cost = better. Multiply to weight both.
		const aScore = aCost === 0 ? Number.POSITIVE_INFINITY : aCtx / aCost;
		const bScore = bCost === 0 ? Number.POSITIVE_INFINITY : bCtx / bCost;
		return bScore - aScore;
	});
	return scored[0] ?? null;
}
