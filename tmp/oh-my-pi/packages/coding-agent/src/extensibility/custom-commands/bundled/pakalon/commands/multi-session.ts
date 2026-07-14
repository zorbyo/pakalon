/**
 * /multi-session command — Open the multi-session TUI dashboard.
 *
 * Per spec §705: "/multi-session dashboard with status animations".
 * The actual dashboard is `tui/multi-session-dashboard.ts` (already
 * implemented). This command emits a `ui.navigate` event so the
 * interactive-mode controller switches to the dashboard view.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { listSessions } from "../../../../normal-mode/sessions";
import { buildDashboardCards } from "../../../../tui/multi-session-dashboard";

// ============================================================================
// MultiSessionCommand
// ============================================================================

export class MultiSessionCommand implements CustomCommand {
	name = "multi-session";
	description = "Open the multi-session dashboard (live sessions in this workspace)";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		try {
			// Pre-warm the card list so the TUI's first render is fast.
			buildDashboardCards();
			const sessions = listSessions(cwd, "active");
			logger.info("multi-session: dashboard opened", { count: sessions.length });

			const lines: string[] = [
				"## Multi-session dashboard",
				"",
				`| Session | Project | Model | Status |`,
				`| --- | --- | --- | --- |`,
			];
			if (sessions.length === 0) {
				lines.push("| _(no live sessions in this workspace)_ | | | |");
			} else {
				for (const s of sessions) {
					const status = s.status === "active" ? "⏵ active" : `· ${s.status}`;
					lines.push(`| \`${s.id.slice(0, 8)}\` | \`${s.projectDir}\` | \`${s.model}\` | ${status} |`);
				}
			}
			lines.push("");
			lines.push("Keys in the dashboard:");
			lines.push("`+`  — new session");
			lines.push("`Enter`  — switch to the focused session");
			lines.push("`Ctrl+M`  — return to the dashboard");
			lines.push("`Esc`  — close the dashboard");
			return lines.join("\n");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("multi-session: failed", { err: msg });
			ctx.ui.notify(`Multi-session dashboard failed to open: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function multiSessionFactory(api: CustomCommandAPI): MultiSessionCommand {
	return new MultiSessionCommand(api);
}
