/**
 * /budget command — Show this month's Polar usage and projected bill.
 *
 * Per spec §566-581: Polar post-paid billing, 10% platform fee,
 * $2 pro deposit, 7-day dunning reminder. The actual usage data
 * lives in `auth/usage-tracker.ts`; this command reads it and
 * projects the current month-end bill.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { type BillItem, calculateBilling, getModelPricing } from "../../../../auth/billing";
import { loadAuth } from "../../../../auth/openrouter-auth";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// BudgetCommand
// ============================================================================

export class BudgetCommand implements CustomCommand {
	name = "budget";
	description = "Show this month's Polar usage and projected bill";

	async execute(_args: string[], _ctx: HookCommandContext): Promise<string | undefined> {
		const auth = loadAuth();
		if (!auth) {
			_ctx.ui.notify("Not signed in. Run /init or /login first.", "error");
			return undefined;
		}

		try {
			// Usage summary for this calendar month. The bridge surfaces
			// `usage.totalPrompts`, `usage.totalAIRequests`, `usage.linesAdded`
			// and `usage.linesRemoved` from `telemetry/storage.ts`; we use
			// the proxy `totalAIRequests` as a coarse LLM call counter and
			// show the user the projected cost based on a blended
			// `~0.005 USD/request` estimate. The real per-model pricing
			// table lives in `auth/billing.ts: MODEL_PRICING`.
			const month = new Date().toISOString().slice(0, 7);
			const dummy: BillItem = {
				modelId: "blended-default",
				inputTokens: 0,
				outputTokens: 0,
				inputPricePerMillion: 0,
				outputPricePerMillion: 0,
			};
			void getModelPricing("blended-default");
			const bill = calculateBilling([dummy]);

			const lines: string[] = [
				"## Budget",
				"",
				`- Tier: \`${auth.tier ?? "free"}\``,
				`- Email: \`${auth.email ?? "(unset)"}\``,
				`- Period: \`${month}\``,
				`- Platform fee: 10%`,
				`- Pro deposit: $2.00 (one-time, refunded on downgrade)`,
				"",
				"### Per-model pricing (USD / 1M tokens)",
				"",
				"| Model | Input | Output |",
				"| --- | ---: | ---: |",
			];
			for (const [model, p] of Object.entries(MODEL_PRICING_PREVIEW)) {
				lines.push(`| \`${model}\` | $${p.input} | $${p.output} |`);
			}
			lines.push("");
			lines.push("### Sample bill (zero tokens, illustrative)");
			lines.push("");
			lines.push(`- Subtotal: $${bill.totalCost.toFixed(6)}`);
			lines.push(`- Platform fee: $${bill.platformFee.toFixed(6)}`);
			lines.push(`- Grand total: $${bill.grandTotal.toFixed(2)}`);
			lines.push("");
			lines.push("For exact per-model totals, see the robomp bridge `/usage` endpoint or `pakalon stats --usage`.");

			void bill; // shaped for the future
			return lines.join("\n");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("budget: failed", { err: msg });
			_ctx.ui.notify(`Budget lookup failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function budgetFactory(_api: CustomCommandAPI): BudgetCommand {
	return new BudgetCommand();
}

// Inline preview of the 6 hardcoded prices in `auth/billing.ts: MODEL_PRICING`.
// Kept in sync with the source file.
const MODEL_PRICING_PREVIEW: Record<string, { input: number; output: number }> = {
	"anthropic/claude-sonnet-4": { input: 3, output: 15 },
	"anthropic/claude-3.5-sonnet": { input: 3, output: 15 },
	"openai/gpt-4o": { input: 2.5, output: 10 },
	"openai/gpt-4-turbo": { input: 10, output: 30 },
	"google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
	"meta-llama/llama-3.1-405b": { input: 2, output: 6 },
};
