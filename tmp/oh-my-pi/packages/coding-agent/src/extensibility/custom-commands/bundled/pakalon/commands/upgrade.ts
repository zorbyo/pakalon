/**
 * /upgrade command — Open the Pro upgrade URL.
 *
 * Per CLI-req.md §585: "The user can install the application via
 * command, and the application will only start if the user is
 * authenticated and then if the user wants to upgrade to pro plan,
 * the interface and the payment gateway will be present in that
 * website will I will create". The actual payment UI lives on the
 * external pakalon website; this command:
 *   1. Resolves the URL (PAKALON_UPGRADE_URL env var,
 *      `pakalon.upgradeUrl` in settings.local.json, or the default
 *      `https://pakalon.dev/upgrade`).
 *   2. Opens it in the default browser via `xdg-open`/`start`/`open`.
 *   3. Shows a TUI summary so the user can copy the URL if the
 *      browser doesn't open.
 *
 * The command is a no-op for Pro users (the URL is still shown for
 * the "renew subscription" case).
 */

import { logger } from "@oh-my-pi/pi-utils";
import { getUserTier, loadAuth } from "../../../../auth/openrouter-auth";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { getUpgradeUrl } from "../../../../pakalon/billing/tier-gate";

// ============================================================================
// UpgradeCommand
// ============================================================================

export class UpgradeCommand implements CustomCommand {
	name = "upgrade";
	description = "Open the Pro plan upgrade URL in your default browser";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const tier = getUserTier();
		const auth = loadAuth();
		const url = getUpgradeUrl({ returnTo: cwd });

		// Best-effort: open the URL in the default browser. The opener
		// is platform-specific; we try a few well-known commands and
		// fall back to "do nothing" if none is on PATH.
		const opened = await tryOpenBrowser(url).catch(err => {
			logger.warn("upgrade: failed to open browser", { err });
			return false;
		});

		const lines: string[] = [
			"## Upgrade to Pro",
			"",
			`- Tier: \`${tier}\``,
			auth?.email ? `- Email: \`${auth.email}\`` : "- Email: _(not signed in)_",
			`- Upgrade URL: \`${url}\``,
			`- Browser opened: ${opened ? "✓" : "✗ (copy the URL above)"}`,
			"",
			"Pro perks:",
			"- All OpenRouter models (no `:free` restriction)",
			"- Higher context window auto-pick",
			"- Pro-only MCPs (Playwright, Chrome DevTools, Vercel agent-browser, Firecrawl)",
			"- SonarQube / Semgrep / Gitleaks security tooling in Phase 4",
			"- Image generation, Penpot sync, multi-cloud deployer",
		];

		ctx.ui.notify(
			opened ? `Opened upgrade page: ${url}` : `Copy this URL to upgrade: ${url}`,
			opened ? "info" : "warning",
		);
		return lines.join("\n");
	}
}

async function tryOpenBrowser(url: string): Promise<boolean> {
	const cmd = pickOpenCommand(url);
	if (!cmd) return false;
	try {
		const { spawn } = await import("node:child_process");
		const child = spawn(cmd.cmd, cmd.args, { detached: true, stdio: "ignore" });
		child.unref();
		return true;
	} catch {
		return false;
	}
}

function pickOpenCommand(url: string): { cmd: string; args: string[] } | null {
	const platform = process.platform;
	if (platform === "win32") return { cmd: "cmd", args: ["/c", "start", "", url] };
	if (platform === "darwin") return { cmd: "open", args: [url] };
	// Linux + others
	return { cmd: "xdg-open", args: [url] };
}

export default function upgradeFactory(api: CustomCommandAPI): UpgradeCommand {
	return new UpgradeCommand(api);
}
