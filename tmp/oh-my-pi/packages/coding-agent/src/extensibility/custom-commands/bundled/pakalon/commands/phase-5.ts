import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { type Phase5Input, type Phase5Output, runPhase5 } from "../../../../phases/phase5";

// Local mirror of platforms.ts:SUPPORTED_PLATFORMS. Kept in sync with
// `packages/coding-agent/src/phases/phase5/platforms.ts`.
const SUPPORTED_PLATFORMS: readonly Phase5Input["platform"][] = [
	"aws",
	"digitalocean",
	"azure",
	"gcp",
	"vercel",
	"netlify",
	"self-host",
	"none",
] as const;

// ============================================================================
// Phase5Command
// ============================================================================

export class Phase5Command implements CustomCommand {
	name = "phase-5";
	description = "Run Phase 5: Deployment (Dockerfile + CI/CD + cloud-push)";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const cwd = this.api.cwd;
		const platform = parsePlatform(args[0]);
		const push = args.includes("--push") || args.includes("-p");
		const noCi = args.includes("--no-ci");
		const noCd = args.includes("--no-cd");
		const repoVisibility = (parseFlag(args, "--visibility") as "public" | "private" | undefined) ?? "private";

		ctx.ui.notify(`Starting Phase 5: Deployment (platform: ${platform}${push ? ", push" : ""})`, "info");

		try {
			const input: Phase5Input = {
				projectDir: cwd,
				projectName: path.basename(cwd),
				platform,
				enableCI: !noCi,
				enableCD: !noCd,
				pushToGitHub: push,
				repoVisibility,
			};
			const output: Phase5Output = await runPhase5(cwd, input);

			const pushedLine = output.githubPushed
				? `Pushed to ${output.githubRepoUrl ?? "GitHub"}`
				: "Not pushed (run with --push to publish)";
			ctx.ui.notify(
				`Phase 5 complete — wrote Dockerfile, docker-compose, ${output.platformFiles.length + 1} platform file(s). ${pushedLine}`,
				"info",
			);

			return summarisePhase5(output);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("phase-5: failed", { err: msg });
			ctx.ui.notify(`Phase 5 failed: ${msg}`, "error");
			return undefined;
		}
	}
}

export default function phase5Factory(api: CustomCommandAPI): Phase5Command {
	return new Phase5Command(api);
}

// ============================================================================
// Helpers
// ============================================================================

function parsePlatform(arg: string | undefined): Phase5Input["platform"] {
	if (!arg) return "vercel";
	const a = arg.toLowerCase();
	if (SUPPORTED_PLATFORMS.includes(a as Phase5Input["platform"])) {
		return a as Phase5Input["platform"];
	}
	return "vercel";
}

function parseFlag(args: string[], flag: string): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === flag) {
			const next = args[i + 1];
			if (next && !next.startsWith("--")) return next;
			return "";
		}
		if (a.startsWith(`${flag}=`)) {
			return a.slice(flag.length + 1);
		}
	}
	return undefined;
}

function summarisePhase5(output: Phase5Output): string {
	const lines: string[] = [
		"## Phase 5 complete",
		"",
		`Platform: **${output.platform}**`,
		`GitHub Actions: \`.github/workflows/pakalon-ci.yml\``,
		`Dockerfile: \`Dockerfile\``,
		`docker-compose: \`docker-compose.yml\``,
		`Env template: \`.env.example\``,
		`Deployment guide: \`DEPLOYMENT.md\``,
		`Phase summary: \`phase-5.md\``,
	];
	if (output.platformFiles.length > 0) {
		lines.push("");
		lines.push(`Per-platform IaC (${output.platformFiles.length} file(s)):`);
		for (const f of output.platformFiles) lines.push(`- \`${f}\``);
	}
	lines.push("");
	lines.push(
		output.githubPushed
			? `Pushed: ${output.githubRepoUrl ?? "(no URL)"}`
			: "Not pushed to GitHub (use --push to publish).",
	);
	lines.push("");
	lines.push("Next: `/phase-6` to write end-user documentation.");
	void output;
	return lines.join("\n");
}
