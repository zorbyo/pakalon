/**
 * /undo command - Undo recent changes (conversation, code, or both)
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import fs from "fs";
import path from "path";

const HISTORY_DIR = (cwd: string) => path.join(cwd, ".pakalon-agents", "history");

export const undoCommand: CommandEntry = {
	name: "undo",
	description: "Undo recent changes (conversation, code, or both)",
	usage: "/undo",
	async execute(_args: string[]) {
		const cwd = process.cwd();
		const historyDir = HISTORY_DIR(cwd);

		fs.mkdirSync(historyDir, { recursive: true });

		try {
			const historyFiles = fs
				.readdirSync(historyDir)
				.filter(f => f.endsWith(".json"))
				.sort()
				.reverse();

			if (historyFiles.length === 0) {
				return {
					success: false,
					message:
						"Error: No recent changes to undo.\n\nTip: Start making changes first, then use /undo to revert them.",
				};
			}

			const latestEntryPath = path.join(historyDir, historyFiles[0]!);
			const latestEntry = JSON.parse(fs.readFileSync(latestEntryPath, "utf-8"));

			const changeType = latestEntry.type || "unknown";
			const timestamp = new Date(latestEntry.timestamp).toLocaleString();
			const description = latestEntry.description || "Recent change";

			return {
				success: true,
				message:
					`Undo Recent Change\n\n` +
					`What: ${description}\n` +
					`When: ${timestamp}\n` +
					`Type: ${changeType}\n\n` +
					`Choose what to undo:\n` +
					`1. Undo conversation\n` +
					`2. Undo code\n` +
					`3. Undo both conversation and code\n` +
					`4. Do nothing\n\n` +
					`Reply with the number (1-4) to proceed.`,
			};
		} catch (err) {
			logger.error("Undo failed", { err });
			return {
				success: false,
				message: `Error: Failed to retrieve undo history: ${err}`,
			};
		}
	},
};

export function recordChange(cwd: string, type: "conversation" | "code" | "both", description: string): void {
	const historyDir = HISTORY_DIR(cwd);
	fs.mkdirSync(historyDir, { recursive: true });

	const entry = {
		id: `change-${Date.now()}`,
		timestamp: new Date().toISOString(),
		type,
		description,
		action: "recorded",
	};

	const filename = `${entry.id}.json`;
	fs.writeFileSync(path.join(historyDir, filename), JSON.stringify(entry, null, 2));

	const files = fs
		.readdirSync(historyDir)
		.filter(f => f.endsWith(".json"))
		.sort();
	if (files.length > 50) {
		for (const oldFile of files.slice(0, files.length - 50)) {
			fs.unlinkSync(path.join(historyDir, oldFile));
		}
	}
}

export default undoCommand;
