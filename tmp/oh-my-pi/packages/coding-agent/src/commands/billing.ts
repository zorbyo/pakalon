/**
 * /billing and /logout commands - Billing management and user authentication
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const USER_CONFIG_PATH = (cwd: string) => path.join(cwd, ".pakalon-agents", "user-config.json");

export const billingCommand: CommandEntry = {
	name: "billing",
	description: "View billing info, usage stats, and payment methods",
	usage: "/billing",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const config = loadUserConfig(cwd);

		const tier = config.tier || "free";
		const deposit = tier === "pro" ? 2.0 : 0;
		const usageThisMonth = config.usageThisMonth || 0;
		const platformFee = usageThisMonth * 0.1;
		const totalDue = usageThisMonth + platformFee + deposit;

		return {
			success: true,
			message:
				`Billing Summary\n\n` +
				`Tier: ${tier.toUpperCase()}\n` +
				`Current period: ${new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}\n\n` +
				`Charges this month:\n` +
				`   - Usage: $${usageThisMonth.toFixed(2)}\n` +
				`   - Platform fee (10%): $${platformFee.toFixed(2)}\n` +
				`${deposit > 0 ? `   - Pro deposit: $${deposit.toFixed(2)}\n` : ""}` +
				`   ----------------------\n` +
				`   Total due: $${totalDue.toFixed(2)}\n\n` +
				`Usage by model:\n${formatModelUsage(config.modelUsage || {})}\n\n` +
				`Next bill: ${getNextBillDate()}\n\n` +
				`Tip: Use /cost for detailed token usage.`,
		};
	},
};

export const logoutCommand: CommandEntry = {
	name: "logout",
	description: "Logout from Pakalon (CLI and web)",
	usage: "/logout",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const configPath = USER_CONFIG_PATH(cwd);

		try {
			if (fs.existsSync(configPath)) {
				const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
				config.authenticated = false;
				config.token = null;
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
			}

			logger.info("User logged out");

			return {
				success: true,
				message:
					"Logged out successfully\n\n" +
					"- CLI session cleared\n" +
					"- Web session cleared\n\n" +
					"Use /pakalon to start a new session or login again.",
			};
		} catch (err) {
			return {
				success: false,
				message: `Error: Logout failed: ${err}`,
			};
		}
	},
};

export const costCommand: CommandEntry = {
	name: "cost",
	description: "Show detailed token usage and cost breakdown",
	usage: "/cost",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const config = loadUserConfig(cwd);

		const breakdown = config.modelUsage || {};
		const totalInput = Object.values(breakdown).reduce((sum: number, u: any) => sum + (u.inputTokens || 0), 0);
		const totalOutput = Object.values(breakdown).reduce((sum: number, u: any) => sum + (u.outputTokens || 0), 0);

		const rows = Object.entries(breakdown)
			.map(([model, usage]: [string, any]) => {
				const cost = (usage.inputCost || 0) + (usage.outputCost || 0);
				return (
					`- ${model}\n` +
					`  Input: ${formatNumber(usage.inputTokens || 0)} tokens\n` +
					`  Output: ${formatNumber(usage.outputTokens || 0)} tokens\n` +
					`  Cost: $${cost.toFixed(4)}\n`
				);
			})
			.join("\n");

		return {
			success: true,
			message:
				`Token Usage & Cost\n\n` +
				`- Total input: ${formatNumber(totalInput)} tokens\n` +
				`- Total output: ${formatNumber(totalOutput)} tokens\n\n` +
				`Cost breakdown:\n${rows || "No usage yet"}\n\n` +
				`Note: Models are sorted by recency. Use /billing for billing summary.`,
		};
	},
};

function loadUserConfig(cwd: string): any {
	const configPath = USER_CONFIG_PATH(cwd);
	if (fs.existsSync(configPath)) {
		try {
			return JSON.parse(fs.readFileSync(configPath, "utf-8"));
		} catch {
			/* ignore */
		}
	}
	return {};
}

function formatModelUsage(
	usage: Record<string, { inputTokens: number; outputTokens: number; inputCost: number; outputCost: number }>,
): string {
	const entries = Object.entries(usage);
	if (entries.length === 0) return "No usage recorded this month.";
	return entries
		.map(
			([model, u]) =>
				`- ${model}: ${formatNumber(u.inputTokens + u.outputTokens)} tokens ($${(u.inputCost + u.outputCost).toFixed(4)})`,
		)
		.join("\n");
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
	return n.toString();
}

function getNextBillDate(): string {
	const now = new Date();
	const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return next.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default billingCommand;
