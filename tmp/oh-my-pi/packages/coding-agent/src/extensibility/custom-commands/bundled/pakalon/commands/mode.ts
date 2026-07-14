/**
 * /mode command — Show or change the deployment mode.
 *
 * Pakalon has two operating modes:
 *  - **cloud**    — full Polar.sh billing, Clerk device-code auth,
 *                   openrouter `:free` + pro models, usage tracked.
 *  - **self-hosted** — no auth, no billing, only local Ollama /
 *                       LM Studio / vLLM, no telemetry.
 *
 * The mode is selected by:
 *  1. `--self-hosted` / `--cloud` CLI flag (highest precedence).
 *  2. `PAKALON_SELFHOST=1` env var.
 *  3. `~/.config/pakalon/selfhost.json` (written by `pakalon
 *     install --self-hosted`).
 *  4. The TUI's mode chooser radio (recorded in
 *     `~/.pakalon/settings.local.json`).
 *
 * Per spec §707-712: the chooser is a TUI radio; this slash
 * command surfaces the current value and documents how to flip
 * it from the shell.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { isSelfHostedMode } from "../../../../pakalon/local-models/registry";

const SELFHOST_FILE = path.join(os.homedir(), ".config", "pakalon", "selfhost.json");
const SETTINGS_FILE = path.join(os.homedir(), ".pakalon", "settings.local.json");

// ============================================================================
// ModeCommand
// ============================================================================

export class ModeCommand implements CustomCommand {
	name = "mode";
	description = "Show or change the deployment mode (cloud | self-hosted)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const requested = args[0]?.toLowerCase();
		if (requested === "self-hosted" || requested === "selfhost" || requested === "self") {
			await writeSelfHostFile(true);
			ctx.ui.notify("Mode set to self-hosted. Auth + billing are now skipped.", "info");
			logger.info("mode: switched to self-hosted", { source: "slash command" });
			return await renderSummary("self-hosted");
		}
		if (requested === "cloud") {
			await writeSelfHostFile(false);
			ctx.ui.notify("Mode set to cloud. Run /init to sign in.", "info");
			logger.info("mode: switched to cloud", { source: "slash command" });
			return await renderSummary("cloud");
		}
		// /mode (no args) — show the current mode.
		const current = isSelfHostedMode() ? "self-hosted" : "cloud";
		return await renderSummary(current);
	}
}

export default function modeFactory(_api: CustomCommandAPI): ModeCommand {
	return new ModeCommand();
}

// ============================================================================
// Helpers
// ============================================================================

async function writeSelfHostFile(enabled: boolean): Promise<void> {
	const dir = path.dirname(SELFHOST_FILE);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(SELFHOST_FILE, JSON.stringify({ enabled }, null, 2), "utf-8");
}

async function readSettingsFile(): Promise<{ mode?: string } | null> {
	try {
		const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
		return JSON.parse(raw) as { mode?: string };
	} catch {
		return null;
	}
}

async function renderSummary(current: "cloud" | "self-hosted"): Promise<string> {
	const source: string[] = [];
	if (process.env.PAKALON_SELFHOST === "1") source.push("env var `PAKALON_SELFHOST=1`");
	try {
		await fs.access(SELFHOST_FILE);
		source.push(`config file \`${SELFHOST_FILE}\``);
	} catch {
		/* not present */
	}
	const settings = await readSettingsFile();
	if (settings?.mode === current) {
		source.push(`\`${SETTINGS_FILE}\` (\`mode: ${current}\`)`);
	}
	const sourceLine = source.length > 0 ? source.join("; ") : "default";

	const lines: string[] = [
		"## Mode",
		"",
		`- **Current**: \`${current}\``,
		`- **Source**: ${sourceLine}`,
		"",
		"### What this means",
		"",
	];
	if (current === "self-hosted") {
		lines.push(
			"- Auth: skipped (no 6-digit pairing).",
			"- Billing: skipped (no Polar.sh; no deposit).",
			"- Models: only the local registry (Ollama / LM Studio / vLLM).",
			"- Telemetry: still emitted (machineId etc.) but no remote ingestion.",
			"- Web companion: requires the local bridge at `PAKALON_BACKEND`.",
		);
	} else {
		lines.push(
			"- Auth: 6-digit device-code flow against Clerk.",
			"- Billing: Polar.sh post-paid; $2 pro deposit; 10% platform fee.",
			"- Models: openrouter free + pro; pro-only for paid users.",
			"- Telemetry: emitted + ingested to the cloud bridge.",
			"- Web companion: hosted at `pakalon.dev`.",
		);
	}
	lines.push("");
	lines.push("### Switching");
	lines.push("");
	lines.push("- `/mode cloud` — switch to cloud mode (writes `selfhost.json`).");
	lines.push("- `/mode self-hosted` — switch to self-hosted mode.");
	lines.push("- `PAKALON_SELFHOST=1 pakalon` — one-shot override via env.");
	lines.push("- `pakalon --self-hosted` — one-shot override via CLI flag.");
	return lines.join("\n");
}
