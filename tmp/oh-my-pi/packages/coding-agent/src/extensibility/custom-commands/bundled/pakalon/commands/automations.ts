/**
 * /automations command — Manage automation workflows.
 *
 * Per CLI-req.md §674 and code.md §22, /automations opens a TUI
 * with: list + create + templates. The Python bridge service (or
 * `cli.ts:116` scheduler) executes the saved automations on their
 * cron schedule and posts results to the configured channel.
 *
 * Subcommands:
 *   /automations                 — show saved automations + menu
 *   /automations list            — show saved automations only
 *   /automations create          — interactive TUI form
 *   /automations templates       — show ready-to-use templates
 *   /automations from-template   — create from a template by id
 *   /automations delete <id>     — remove an automation
 *   /automations pause <id>      — pause an automation
 *   /automations resume <id>     — resume an automation
 *   /automations runs <id>       — show run history
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import {
	type AutomationType,
	createAutomation as createAutomationRecord,
	deleteAutomation,
	formatAutomationList,
	formatRunHistory,
	pauseAutomation,
	resumeAutomation,
} from "../../../../normal-mode/automations";

// ============================================================================
// Built-in templates
// ============================================================================

export interface AutomationTemplate {
	id: string;
	name: string;
	description: string;
	prompt: string;
	schedule: string;
	connectors: string[];
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
	{
		id: "pr-checker",
		name: "GitHub PR → Slack",
		description: "Every hour, check for new PR issues in a repo and post them to Slack.",
		prompt:
			"Check the connected GitHub repo for any open PRs that have failing checks, unresolved review comments, or are marked 'changes requested'. Post a summary to the connected Slack channel with the PR title, author, and a 1-line summary of the failure.",
		schedule: "0 * * * *",
		connectors: ["github", "slack"],
	},
	{
		id: "issue-triage",
		name: "GitHub Issue → Slack",
		description: "Every 30 minutes, summarise new GitHub issues and post to Slack.",
		prompt:
			"For each new GitHub issue in the last 30 minutes, generate a 1-line summary and post it to the connected Slack channel along with the issue title, author, and labels.",
		schedule: "*/30 * * * *",
		connectors: ["github", "slack"],
	},
	{
		id: "dep-update",
		name: "Dependency Update → Email",
		description: "Daily at 9am, check for outdated npm dependencies and email a summary.",
		prompt:
			"Run `npm outdated` in the project root. For each major-version bump, send an email listing the package, current version, latest version, and the breaking-changes URL.",
		schedule: "0 9 * * *",
		connectors: ["email"],
	},
	{
		id: "ci-monitor",
		name: "CI Failure → Telegram",
		description: "Every 15 minutes, alert on Telegram for any failing CI runs.",
		prompt:
			"Check the connected GitHub repo for any CI runs that failed in the last 15 minutes. Post a Telegram message with the run URL, the failing step, and the commit message.",
		schedule: "*/15 * * * *",
		connectors: ["github", "telegram"],
	},
	{
		id: "daily-standup",
		name: "Daily Standup → Slack",
		description: "Weekdays at 9am, post a standup template to Slack with yesterday's commits.",
		prompt:
			"List the last 24h of commits in the connected GitHub repo. Post a standup template to the connected Slack channel with sections 'Yesterday', 'Today', 'Blockers' and a 1-line summary per commit.",
		schedule: "0 9 * * 1-5",
		connectors: ["github", "slack"],
	},
];

// ============================================================================
// AutomationsCommand
// ============================================================================

export class AutomationsCommand implements CustomCommand {
	name = "automations";
	description = "Manage automation workflows (cron jobs, GitHub, Slack, Telegram)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const sub = (args[0] ?? "list").toLowerCase();
		const rest = args.slice(1);

		try {
			switch (sub) {
				case "list":
				case "":
					return this.handleList(cwd);
				case "create":
					return this.handleCreate(rest, ctx);
				case "templates":
					return this.handleTemplates();
				case "from-template":
					return this.handleFromTemplate(rest, cwd);
				case "delete":
				case "remove":
					return this.handleDelete(rest, cwd, ctx);
				case "pause":
					return this.handlePause(rest, cwd, ctx);
				case "resume":
					return this.handleResume(rest, cwd, ctx);
				case "runs":
					return this.handleRuns(rest, cwd);
				default:
					return this.handleMenu(cwd, ctx);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`/automations ${sub} failed: ${msg}`, "error");
			return undefined;
		}
	}

	// ────────────────────────────────────────────────────────────────────
	// list / menu
	// ────────────────────────────────────────────────────────────────────
	private handleList(cwd: string): string {
		const list = formatAutomationList(cwd);
		return [
			list,
			"",
			"Subcommands:",
			"  /automations list              — show saved automations",
			"  /automations create            — create a new automation",
			"  /automations templates         — show ready-to-use templates",
			"  /automations from-template <id>— create from a template",
			"  /automations delete <id>       — delete an automation",
			"  /automations pause <id>        — pause an automation",
			"  /automations resume <id>       — resume an automation",
			"  /automations runs <id>         — show run history",
		].join("\n");
	}

	private handleMenu(cwd: string, ctx: HookCommandContext): string {
		const out = this.handleList(cwd);
		ctx.ui.notify(`Unknown /automations subcommand. Showing help.`, "warning");
		return out;
	}

	// ────────────────────────────────────────────────────────────────────
	// create
	// ────────────────────────────────────────────────────────────────────
	private async handleCreate(_args: string[], ctx: HookCommandContext): Promise<string> {
		const name = (await ctx.ui.input("Automation name", "e.g., PR Checker")) || "";
		if (!name.trim()) {
			ctx.ui.notify("Automation name is required.", "error");
			return "Automation name is required.";
		}
		const prompt = (await ctx.ui.input("Task prompt", "e.g., Check for PR issues and notify on Slack")) || "";
		const schedule = (await ctx.ui.input("Schedule (cron format)", "e.g., 0 9 * * * (daily at 9am)")) || "0 9 * * *";
		const connectorsStr =
			(await ctx.ui.input("Connectors (comma-separated)", "e.g., github, slack or none")) || "none";
		const connectors = connectorsStr === "none" ? [] : connectorsStr.split(",").map(c => c.trim());
		const type: AutomationType = connectors.length === 0 ? "manual" : "cron";

		const auto = createAutomationRecord(ctx.cwd, name.trim(), type, prompt.trim(), {
			schedule: type === "cron" ? schedule : undefined,
		});
		ctx.ui.notify(`Automation "${name}" created (${auto.id}).`, "info");
		return [
			`## Automation created: ${name}`,
			``,
			`- ID: \`${auto.id}\``,
			`- Type: ${type}`,
			`- Schedule: \`${schedule}\``,
			`- Connectors: ${connectors.join(", ") || "none"}`,
			`- Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? "…" : ""}`,
		].join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// templates
	// ────────────────────────────────────────────────────────────────────
	private handleTemplates(): string {
		const lines: string[] = ["## Automation templates", ""];
		for (const t of AUTOMATION_TEMPLATES) {
			lines.push(`### ${t.id}`);
			lines.push(`- **Name**: ${t.name}`);
			lines.push(`- **Description**: ${t.description}`);
			lines.push(`- **Schedule**: \`${t.schedule}\``);
			lines.push(`- **Connectors**: ${t.connectors.join(", ")}`);
			lines.push("");
		}
		lines.push("Create one with: `/automations from-template <id>`");
		return lines.join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// from-template
	// ────────────────────────────────────────────────────────────────────
	private handleFromTemplate(args: string[], cwd: string): string {
		const id = (args[0] ?? "").trim();
		if (!id) {
			return "Usage: /automations from-template <id>. Run `/automations templates` to list ids.";
		}
		const tpl = AUTOMATION_TEMPLATES.find(t => t.id === id);
		if (!tpl) {
			return `Unknown template: ${id}. Run \`/automations templates\` to list ids.`;
		}
		const type: AutomationType = tpl.connectors.length === 0 ? "manual" : "cron";
		const auto = createAutomationRecord(cwd, tpl.name, type, tpl.prompt, { schedule: tpl.schedule });
		return [
			`## Automation created from template: ${tpl.name}`,
			``,
			`- ID: \`${auto.id}\``,
			`- Schedule: \`${tpl.schedule}\``,
			`- Connectors: ${tpl.connectors.join(", ")}`,
			`- Prompt: ${tpl.prompt.slice(0, 200)}${tpl.prompt.length > 200 ? "…" : ""}`,
		].join("\n");
	}

	// ────────────────────────────────────────────────────────────────────
	// delete / pause / resume
	// ────────────────────────────────────────────────────────────────────
	private handleDelete(args: string[], cwd: string, ctx: HookCommandContext): string {
		const id = (args[0] ?? "").trim();
		if (!id) {
			ctx.ui.notify("Usage: /automations delete <id>", "error");
			return "Usage: /automations delete <id>";
		}
		const ok = deleteAutomation(cwd, id);
		ctx.ui.notify(ok ? `Automation "${id}" deleted.` : `Automation "${id}" not found.`, ok ? "info" : "warning");
		return ok ? `Deleted automation ${id}.` : `Automation ${id} not found.`;
	}

	private handlePause(args: string[], cwd: string, ctx: HookCommandContext): string {
		const id = (args[0] ?? "").trim();
		if (!id) {
			ctx.ui.notify("Usage: /automations pause <id>", "error");
			return "Usage: /automations pause <id>";
		}
		const ok = pauseAutomation(cwd, id);
		ctx.ui.notify(ok ? `Automation "${id}" paused.` : `Automation "${id}" not found.`, ok ? "info" : "warning");
		return ok ? `Paused ${id}.` : `Automation ${id} not found.`;
	}

	private handleResume(args: string[], cwd: string, ctx: HookCommandContext): string {
		const id = (args[0] ?? "").trim();
		if (!id) {
			ctx.ui.notify("Usage: /automations resume <id>", "error");
			return "Usage: /automations resume <id>";
		}
		const ok = resumeAutomation(cwd, id);
		ctx.ui.notify(ok ? `Automation "${id}" resumed.` : `Automation "${id}" not found.`, ok ? "info" : "warning");
		return ok ? `Resumed ${id}.` : `Automation ${id} not found.`;
	}

	// ────────────────────────────────────────────────────────────────────
	// runs
	// ────────────────────────────────────────────────────────────────────
	private handleRuns(args: string[], cwd: string): string {
		const id = (args[0] ?? "").trim();
		if (!id) {
			return "Usage: /automations runs <id>";
		}
		return formatRunHistory(cwd, id, 20);
	}
}

export default function automationsFactory(api: CustomCommandAPI): AutomationsCommand {
	return new AutomationsCommand(api);
}
