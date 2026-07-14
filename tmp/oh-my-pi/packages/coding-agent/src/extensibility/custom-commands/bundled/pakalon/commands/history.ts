import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import {
	formatFileChangeHistory,
	formatFullHistory,
	formatHistory,
	formatHistorySummary,
	formatPromptHistory,
} from "../../../../normal-mode/history";

// ============================================================================
// HistoryCommand
// ============================================================================

export class HistoryCommand implements CustomCommand {
	name = "history";
	description = "Show session history with prompts, file changes, and token usage";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const subcommand = (args[0] || "full").toLowerCase();
		const limit = Number.parseInt(args[1] || "7", 10);
		const projectPath = this.api.cwd;

		switch (subcommand) {
			case "full": {
				const output = formatFullHistory(projectPath, limit);
				ctx.ui.notify(output, "info");
				return undefined;
			}
			case "changes":
			case "files": {
				const output = formatFileChangeHistory(projectPath, limit);
				ctx.ui.notify(output, "info");
				return undefined;
			}
			case "prompts": {
				const output = formatPromptHistory(projectPath, limit);
				ctx.ui.notify(output, "info");
				return undefined;
			}
			case "summary": {
				const output = formatHistorySummary(projectPath, limit);
				ctx.ui.notify(output, "info");
				return undefined;
			}
			default: {
				// Legacy: treat as a number for session count
				const sessionLimit = Number.parseInt(subcommand, 10) || 7;
				const output = formatHistory(projectPath, sessionLimit);
				ctx.ui.notify(output, "info");
				return undefined;
			}
		}
	}
}

export default function historyFactory(api: CustomCommandAPI): HistoryCommand {
	return new HistoryCommand(api);
}
