/**
 * /fix-issues command — Diagnose, reproduce, and (when possible)
 * automatically fix open GitHub issues in parallel.
 *
 * Per the `.omp/commands/fix-issues.md` spec, this command:
 *  1. Lists open issues via `gh issue list`.
 *  2. For each one, opens a worktree under `~/.omp/wt/<encoded>/fix-issue-<N>`.
 *  3. Reproduces the issue.
 *  4. If reproducible, opens a draft PR with the fix.
 *  5. Reports `fixed / already-fixed-by-PR / needs-info / cannot-reproduce`.
 *
 * Skips if no `gh` CLI or no remote. For now this is a stub that
 * surfaces the help; a real implementation is tracked separately.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export class FixIssuesCommand implements CustomCommand {
	name = "fix-issues";
	description = "Diagnose, reproduce, and fix open GitHub issues in parallel worktrees";

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		ctx.ui.notify("fix-issues: surfacing help (full implementation pending)", "info");
		logger.info("fix-issues: stub invoked");
		return [
			"## /fix-issues",
			"",
			"This command is currently a stub. When implemented it will:",
			"",
			"1. Run `gh issue list --state open --limit 50`.",
			"2. For each issue, create a worktree under `~/.omp/wt/<encoded>/fix-issue-<N>`.",
			"3. Reproduce the issue with a failing test.",
			"4. Patch the code, run the test suite, and open a draft PR.",
			"5. Report `fixed / already-fixed-by-PR / needs-info / cannot-reproduce` per issue.",
			"",
			"See `.omp/commands/fix-issues.md` for the full spec.",
		].join("\n");
	}
}

export default function fixIssuesFactory(_api: CustomCommandAPI): FixIssuesCommand {
	return new FixIssuesCommand();
}
