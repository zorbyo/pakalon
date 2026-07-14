/**
 * /automations command - Automation workflow management
 */

import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const AUTOMATIONS_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "automations");
const AUTOMATIONS_CONFIG = (cwd: string) => path.join(AUTOMATIONS_DIR(cwd), "automations.json");

export const automationsCommand: CommandEntry = {
	name: "automations",
	description: "Manage automation workflows",
	usage: "/automations [list|create|delete]",
	async execute(args: string[]) {
		const cwd = process.cwd();
		const action = args[0]?.toLowerCase() || "list";

		fs.mkdirSync(AUTOMATIONS_DIR(cwd), { recursive: true });

		switch (action) {
			case "list":
				return listAutomations(cwd);
			case "create":
				return createAutomation(cwd, args.slice(1));
			case "delete":
				return deleteAutomation(cwd, args[1]);
			case "templates":
				return showTemplates();
			default:
				return {
					success: false,
					message:
						`Error: Unknown action: ${action}\n\n` +
						`Usage: /automations [list|create|delete|templates]\n\n` +
						`Examples:\n` +
						`   /automations list\n` +
						`   /automations create\n` +
						`   /automations delete <name>\n` +
						`   /automations templates`,
				};
		}
	},
};

function listAutomations(cwd: string): { success: boolean; message: string } {
	const configPath = AUTOMATIONS_CONFIG(cwd);

	if (!fs.existsSync(configPath)) {
		return {
			success: true,
			message:
				"Automations\n\nNo automations configured yet.\n\n" +
				"Tip: Use /automations create to create a new automation workflow.\n" +
				"Docs: Use /automations templates to see available templates.",
		};
	}

	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const automations = config.automations || [];

		if (automations.length === 0) {
			return {
				success: true,
				message:
					"Automations\n\nNo automations configured yet.\n\n" +
					"Tip: Use /automations create to create a new automation workflow.",
			};
		}

		const list = automations
			.map(
				(a: { name: string; description?: string; cron?: string; status?: string }, i: number) =>
					`${i + 1}. **${a.name}**\n` +
					`   Description: ${a.description || "No description"}\n` +
					`   Schedule: ${a.cron || "Manual"}\n` +
					`   Status: ${a.status || "active"}\n`,
			)
			.join("\n");

		return {
			success: true,
			message:
				`Automations (${automations.length})\n\n${list}\n\n` +
				`Tip: Use /automations create to add a new automation\n` +
				`Delete: Use /automations delete <name> to remove one`,
		};
	} catch (err) {
		return {
			success: false,
			message: `Error: Failed to load automations: ${err}`,
		};
	}
}

function createAutomation(cwd: string, _args: string[]): { success: boolean; message: string } {
	const _configPath = AUTOMATIONS_CONFIG(cwd);

	return {
		success: true,
		message:
			"Create Automation\n\n" +
			"Opening automation creator...\n\n" +
			"Steps:\n" +
			"1. Name your automation\n" +
			"2. Describe the task (e.g., 'check PR issues and update Slack')\n" +
			"3. Connect required services (GitHub, Slack, etc.)\n" +
			"4. Set schedule (cron) or manual trigger\n" +
			"5. Save and activate\n\n" +
			"Example automation:\n" +
			"   - Name: PR Issue Monitor\n" +
			"   - Prompt: Check repo owner/repo for PR issues and post to #dev-channel\n" +
			"   - Services: GitHub, Slack\n" +
			"   - Schedule: Every hour\n\n" +
			"Full interactive creator coming soon.",
	};
}

function deleteAutomation(cwd: string, name?: string): { success: boolean; message: string } {
	if (!name) {
		return {
			success: false,
			message: "Error: Please provide the automation name.\n\nUsage: /automations delete <name>",
		};
	}

	const configPath = AUTOMATIONS_CONFIG(cwd);
	if (!fs.existsSync(configPath)) {
		return {
			success: false,
			message: `Error: Automation '${name}' not found.`,
		};
	}

	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const automations = config.automations || [];
		const filtered = automations.filter((a: { name: string }) => a.name !== name);

		if (filtered.length === automations.length) {
			return {
				success: false,
				message: `Error: Automation '${name}' not found.`,
			};
		}

		config.automations = filtered;
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		return {
			success: true,
			message: `[OK] Automation '${name}' deleted successfully.\n\n` + `Remaining automations: ${filtered.length}`,
		};
	} catch (err) {
		return {
			success: false,
			message: `Error: Failed to delete automation: ${err}`,
		};
	}
}

function showTemplates(): { success: boolean; message: string } {
	return {
		success: true,
		message:
			"Automation Templates\n\n" +
			"1. **PR Issue Monitor**\n" +
			"   - Monitors GitHub PRs for issues\n" +
			"   - Sends alerts to Slack\n" +
			"   - Schedule: Every hour\n\n" +
			"2. **Daily Build Check**\n" +
			"   - Checks CI/CD pipeline status\n" +
			"   - Notifies on failures\n" +
			"   - Schedule: Every 6 hours\n\n" +
			"3. **Security Scan**\n" +
			"   - Runs security scans nightly\n" +
			"   - Generates reports\n" +
			"   - Schedule: Daily at 2 AM\n\n" +
			"4. **Code Review Assistant**\n" +
			"   - Auto-reviews new PRs\n" +
			"   - Comments suggestions\n" +
			"   - Trigger: On PR creation\n\n" +
			"Tip: Use /automations create to create from a template.",
	};
}

export default automationsCommand;
