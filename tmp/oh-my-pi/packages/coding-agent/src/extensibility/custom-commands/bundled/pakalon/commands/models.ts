/**
 * /models command — Model picker filtered by plan.
 *
 * Per spec §532, 671:
 * - Free users see only models with `:free` suffix.
 * - Pro users see all available models.
 * - Default is `auto` (highest-context, lowest-cost).
 *
 * Subcommands:
 *   `/models`                — show the picker info.
 *   `/models <model-id>`     — switch to the named model.
 *   `/models refresh`        — force a refresh of the OpenRouter
 *                              model catalog from the robomp bridge.
 *   `/models auto`           — re-pick the default `auto` model.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { isFreeModel } from "../../../../auth/billing";
import { getUserTier } from "../../../../auth/openrouter-auth";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { fetchOpenRouterModels } from "../../../../models/dynamic-registry";
import { filterByTier, selectAutoModel } from "../../../../models/tier-filter";

// ============================================================================
// ModelsCommand
// ============================================================================

export class ModelsCommand implements CustomCommand {
	name = "models";
	description = "Choose an AI model (filtered by your plan) or refresh the catalog";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const sub = args[0]?.toLowerCase();

		// /models refresh — fetch the latest OpenRouter catalog.
		if (sub === "refresh") {
			ctx.ui.notify("Refreshing OpenRouter model catalog...", "info");
			try {
				const models = await fetchOpenRouterModels();
				ctx.ui.notify(`Refreshed — ${models.length} models in the local cache.`, "info");
				return summariseRefresh(models.length);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.warn("models: refresh failed", { err: msg });
				ctx.ui.notify(`Model refresh failed: ${msg}`, "error");
				return undefined;
			}
		}

		// /models auto — re-pick the default `auto` model.
		if (sub === "auto") {
			const tier = getUserTier();
			const models = filterByTier(await fetchOpenRouterModels(), tier);
			const picked = selectAutoModel(models);
			if (!picked) {
				ctx.ui.notify("No models available for the current tier.", "error");
				return undefined;
			}
			ctx.ui.notify(`Auto-selected: ${picked.id}`, "info");
			return `Set the active model to \`${picked.id}\` (auto-picked for tier \`${tier}\`).`;
		}

		// /models <model-id> — switch to a specific model.
		if (sub && sub !== "refresh" && sub !== "auto") {
			const tier = getUserTier();
			if (tier === "free" && !isFreeModel(sub)) {
				ctx.ui.notify(
					`\`${sub}\` is a pro-only model. Run \`/models refresh\` and pick one with the \`:free\` suffix.`,
					"error",
				);
				return undefined;
			}
			ctx.ui.notify(`Setting model to: ${sub}`, "info");
			return `Set the active model to: \`${sub}\`. All subsequent prompts will use this model.`;
		}

		// /models (no args) — show the picker info.
		const lines = [
			"## Available Models",
			"",
			"Models are filtered by your plan:",
			"- **Free plan**: Only models with `:free` suffix",
			"- **Pro plan**: All available models",
			"",
			"**Default**: `auto` (selects the best model for the task)",
			"",
			"Commands:",
			"- `/models` — show this help",
			"- `/models <model-id>` — switch to a specific model",
			"- `/models auto` — re-pick the default `auto` model",
			"- `/models refresh` — re-fetch the OpenRouter catalog",
			"",
			"Use `Tab` to cycle between Plan/Edit/Auto-accept/Bypass modes.",
		];
		ctx.ui.notify(lines.join("\n"), "info");
		return undefined;
	}
}

export default function modelsFactory(api: CustomCommandAPI): ModelsCommand {
	return new ModelsCommand(api);
}

// ============================================================================
// Helpers
// ============================================================================

function summariseRefresh(count: number): string {
	return [
		"## Model catalog refreshed",
		"",
		`Indexed \`${count}\` model(s) from OpenRouter.`,
		"",
		"Free users see only models with the `:free` suffix.",
		"Pro users see all models. Use `/models <id>` to switch.",
		"",
		"Use `/models auto` to re-pick the default `auto` selection.",
	].join("\n");
}
