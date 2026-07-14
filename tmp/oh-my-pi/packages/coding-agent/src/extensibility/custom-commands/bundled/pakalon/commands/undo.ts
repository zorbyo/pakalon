/**
 * /undo command — Undo recent changes with 4 options.
 *
 * For code reverts, executes git restore directly (instead of just
 * returning a prompt). For conversation reverts, returns a targeted
 * prompt to the LLM.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export class UndoCommand implements CustomCommand {
	name = "undo";
	description = "Undo recent changes (conversation, code, or both)";

	constructor(private readonly api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const choice = await ctx.ui.input(
			"Undo Options",
			"1. Undo conversation\n2. Undo code\n3. Undo code and conversation\n4. Do nothing",
		);

		switch (choice?.trim()) {
			case "1":
			case "conversation":
				ctx.ui.notify("Undoing last conversation turn...", "info");
				return [
					"## /undo — Revert conversation",
					"",
					"Undo the last conversation turn. Revert the most recent assistant response and continue from there.",
					"",
					"If possible, remove the last assistant message from the conversation history.",
					"Do NOT touch any files on disk — only the conversational history.",
				].join("\n");

			case "2":
			case "code": {
				ctx.ui.notify("Checking git state...", "info");
				const result = await this.revertCodeChanges(ctx);
				if (result === "no_changes") {
					ctx.ui.notify("No uncommitted code changes to revert.", "info");
					return undefined;
				}
				if (result === "reverted") {
					ctx.ui.notify("Uncommitted code changes reverted via git restore.", "info");
					return undefined;
				}
				// If we got a prompt back, pass it through to the LLM
				if (result?.startsWith("##")) {
					return result;
				}
				ctx.ui.notify("Code reverted via git.", "info");
				return undefined;
			}

			case "3":
			case "both": {
				ctx.ui.notify("Checking git state and reverting code...", "info");
				const codeResult = await this.revertCodeChanges(ctx);
				if (codeResult === "no_changes") {
					ctx.ui.notify("No uncommitted code changes — reverting conversation only.", "info");
				} else if (codeResult === "reverted") {
					ctx.ui.notify("Uncommitted code changes reverted.", "info");
				}
				return [
					"## /undo — Revert conversation + code done",
					"",
					"Code changes have been reverted already (git restore).",
					"Now undo the last conversation turn: remove the most recent assistant response",
					"from the conversation history and continue from there.",
					"Do NOT touch any files on disk.",
				].join("\n");
			}

			case "4":
			case "nothing":
				ctx.ui.notify("No changes undone.", "info");
				return undefined;

			default:
				ctx.ui.notify("Invalid choice. No changes made.", "info");
				return undefined;
		}
	}

	/**
	 * Revert uncommitted code changes via git restore.
	 * Returns "no_changes", "reverted", or a prompt string for complex cases.
	 */
	private async revertCodeChanges(ctx: HookCommandContext): Promise<"no_changes" | "reverted" | string> {
		try {
			const statusResult = await this.api.exec("git", ["status", "--porcelain"]);
			const changes = statusResult.stdout.trim();

			if (!changes) {
				const logResult = await this.api.exec("git", ["log", "--oneline", "-5"]);
				const recent = logResult.stdout.trim();
				if (recent) {
					return [
						"## /undo — Revert recent commit",
						"",
						"No uncommitted changes found. Recent commits:",
						"",
						"```",
						recent,
						"```",
						"",
						"Review the recent commits above. If one should be reverted, run",
						"`git revert --no-commit HEAD` to undo the most recent commit.",
						"Do NOT touch any files beyond what git revert handles.",
					].join("\n");
				}
				return "no_changes";
			}

			const statResult = await this.api.exec("git", ["diff", "--stat"]);
			const fileList = statResult.stdout.trim();

			logger.info("/undo: reverting uncommitted changes", { files: fileList });
			await this.api.exec("git", ["restore", "."]);
			await this.api.exec("git", ["clean", "-fd"]).catch(() => {});

			ctx.ui.notify(`Reverted:\n${fileList || changes}`, "info");
			return "reverted";
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("/undo: git revert failed", { err: msg });
			return [
				"## /undo — Code revert (git failed)",
				"",
				`Automatic git revert failed: ${msg}`,
				"",
				"Please manually undo the most recent code changes using git checkout",
				"or your editor's undo. Keep the conversation intact.",
			].join("\n");
		}
	}
}

export default function undoFactory(api: CustomCommandAPI): UndoCommand {
	return new UndoCommand(api);
}
