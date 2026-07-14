/**
 * /review-prs command — Walk every open PR on the current repo, score
 * it, and surface a verdict (ship, fix, or close).
 *
 * Currently a stub — the real implementation is tracked separately.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export class ReviewPrsCommand implements CustomCommand {
	name = "review-prs";
	description = "Walk every open PR, score it, and surface a ship/fix/close verdict";

	async execute(_args: string[], _ctx: HookCommandContext): Promise<string | undefined> {
		logger.info("review-prs: stub invoked");
		return [
			"## /review-prs",
			"",
			"This command is currently a stub. When implemented it will:",
			"",
			"1. Run `gh pr list --state open --limit 30`.",
			"2. For each PR, run the reviewer sub-agent:",
			"   - `gh pr diff` for the diff.",
			"   - LLM review with the `reviewer` system prompt.",
			"3. Score the PR (P0/P1/P2/P3 per finding + confidence).",
			"4. Render the verdict: **ship** / **needs-fix** / **close**.",
			"5. For **needs-fix** PRs, post a checklist comment with the top-3 findings.",
		].join("\n");
	}
}

export default function reviewPrsFactory(_api: CustomCommandAPI): ReviewPrsCommand {
	return new ReviewPrsCommand();
}
