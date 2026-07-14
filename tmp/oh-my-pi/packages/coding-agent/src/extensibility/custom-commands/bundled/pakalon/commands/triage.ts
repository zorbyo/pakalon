/**
 * /triage command — Triage issues that lack labels, assignees, or
 * reproduction context.
 *
 * Currently a stub — the real implementation is tracked separately.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export class TriageCommand implements CustomCommand {
	name = "triage";
	description = "Triage open issues that lack labels, assignees, or reproduction context";

	async execute(_args: string[], _ctx: HookCommandContext): Promise<string | undefined> {
		logger.info("triage: stub invoked");
		return [
			"## /triage",
			"",
			"This command is currently a stub. When implemented it will:",
			"",
			"1. Run `gh issue list --state open --label none --limit 100`.",
			"2. For each unlabeled issue, classify by body:",
			"   - `bug` (has repro steps), `feature` (asks for new functionality),",
			"     `question` (asks how-to), or `unknown`.",
			"3. Apply the label and assign the most-recent-active maintainer.",
			"4. Surface any issue that needs a maintainer's attention (no assignee, no activity > 30 days).",
		].join("\n");
	}
}

export default function triageFactory(_api: CustomCommandAPI): TriageCommand {
	return new TriageCommand();
}
