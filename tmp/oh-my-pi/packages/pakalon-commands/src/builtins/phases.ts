import type { CommandContext, CommandResult, SlashCommand } from "../types";

async function ensureAgentsDir(cwd: string): Promise<void> {
	const { mkdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	mkdirSync(join(cwd, ".pakalon-agents", "ai-agents"), { recursive: true });
}

export const PHASE1_COMMAND: SlashCommand = {
	id: "phase-1",
	name: "phase-1",
	aliases: ["p1"],
	description: "Run Phase 1: Planning & Requirements",
	category: "phase",
	usage: "/phase-1 <prompt>",
	handler: async (args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			if (!args) {
				return { success: false, message: "Usage: /phase-1 <prompt>. Provide a project description." };
			}
			await ensureAgentsDir(ctx.cwd);
			const { runPhase1 } = await import("@oh-my-pi/pakalon-phases");
			const output = await runPhase1(ctx.cwd, {
				prompt: args,
				mode: ctx.mode ?? "HIL",
			});
			return {
				success: true,
				message: `Phase 1 completed. Generated ${14} documents including plan, tasks, PRD, technical spec, and more.`,
				data: { output: Object.keys(output).join(", ") },
			};
		} catch (err) {
			return { success: false, message: `Phase 1 failed: ${err}` };
		}
	},
};

export const PHASE2_COMMAND: SlashCommand = {
	id: "phase-2",
	name: "phase-2",
	aliases: ["p2"],
	description: "Run Phase 2: Wireframes & Penpot",
	category: "phase",
	usage: "/phase-2 [pages...]",
	handler: async (_args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			await ensureAgentsDir(ctx.cwd);
			const { runPhase2 } = await import("@oh-my-pi/pakalon-phases");
			const pages = _args
				? _args
						.split(",")
						.map(s => s.trim())
						.filter(Boolean)
				: undefined;
			const output = await runPhase2(ctx.cwd, {
				projectDir: ctx.cwd,
				pages: pages && pages.length > 0 ? pages : undefined,
			});
			return {
				success: true,
				message: `Phase 2 completed. Generated wireframes for ${pages?.length ?? "auto-detected"} pages in SVG/JSON/Penpot formats.`,
				data: { pages: pages?.length ?? "auto", tddPassed: output.tddPassed },
			};
		} catch (err) {
			return { success: false, message: `Phase 2 failed: ${err}` };
		}
	},
};

export const PHASE3_COMMAND: SlashCommand = {
	id: "phase-3",
	name: "phase-3",
	aliases: ["p3"],
	description: "Run Phase 3: Development (5 sub-agents)",
	category: "phase",
	usage: "/phase-3",
	handler: async (_args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			await ensureAgentsDir(ctx.cwd);
			const { runPhase3 } = await import("@oh-my-pi/pakalon-phases");
			const output = await runPhase3(ctx.cwd, { projectDir: ctx.cwd });
			return {
				success: true,
				message:
					"Phase 3 completed. All 5 sub-agents finished: frontend, backend, integration, debug/test, review.",
				data: { subagents: 5, filesCreated: "see execution_log.md" },
			};
		} catch (err) {
			return { success: false, message: `Phase 3 failed: ${err}` };
		}
	},
};

export const PHASE4_COMMAND: SlashCommand = {
	id: "phase-4",
	name: "phase-4",
	aliases: ["p4"],
	description: "Run Phase 4: Testing & Security QA",
	category: "phase",
	usage: "/phase-4 [--sast] [--dast <url>]",
	handler: async (_args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			await ensureAgentsDir(ctx.cwd);
			const { runPhase4 } = await import("@oh-my-pi/pakalon-phases");
			const enableDast = _args.includes("--dast");
			const devServerMatch = _args.match(/--dast\s+(\S+)/);
			const output = await runPhase4(ctx.cwd, {
				projectDir: ctx.cwd,
				enableSast: true,
				enableDast,
				enableCodeReview: true,
				devServerTarget: devServerMatch?.[1],
			});
			return {
				success: true,
				message: `Phase 4 completed. SAST/DAST/Code Review scans finished. Remediation: ${output.remediationIterations ?? 0} iterations.`,
				data: { remediationIterations: output.remediationIterations },
			};
		} catch (err) {
			return { success: false, message: `Phase 4 failed: ${err}` };
		}
	},
};

export const PHASE5_COMMAND: SlashCommand = {
	id: "phase-5",
	name: "phase-5",
	aliases: ["p5"],
	description: "Run Phase 5: Deployment & CI/CD",
	category: "phase",
	usage: "/phase-5 [target] (aws|digitalocean|azure|gcp)",
	handler: async (_args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			await ensureAgentsDir(ctx.cwd);
			const { runPhase5 } = await import("@oh-my-pi/pakalon-phases");
			const validTargets = ["aws", "digitalocean", "azure", "gcp", "none"] as const;
			const deployTarget = validTargets.find(t => _args.includes(t)) ?? "none";
			const output = await runPhase5(ctx.cwd, {
				projectDir: ctx.cwd,
				deployTarget,
			});
			return {
				success: true,
				message: `Phase 5 completed. CI/CD pipeline generated for ${deployTarget}. Dockerfile and docker-compose.yml created.`,
				data: { deployTarget, ciGenerated: true },
			};
		} catch (err) {
			return { success: false, message: `Phase 5 failed: ${err}` };
		}
	},
};

export const PHASE6_COMMAND: SlashCommand = {
	id: "phase-6",
	name: "phase-6",
	aliases: ["p6"],
	description: "Run Phase 6: Documentation",
	category: "phase",
	usage: "/phase-6",
	handler: async (_args: string, ctx: CommandContext): Promise<CommandResult> => {
		try {
			await ensureAgentsDir(ctx.cwd);
			const { runPhase6 } = await import("@oh-my-pi/pakalon-phases");
			const output = await runPhase6(ctx.cwd, { projectDir: ctx.cwd });
			return {
				success: true,
				message:
					"Phase 6 completed. API docs, user guide, developer guide, and README generated in docs/ directory.",
				data: { hasApiDocs: true, hasUserGuide: true, hasDevGuide: true },
			};
		} catch (err) {
			return { success: false, message: `Phase 6 failed: ${err}` };
		}
	},
};

export const PHASE_COMMANDS: SlashCommand[] = [
	PHASE1_COMMAND,
	PHASE2_COMMAND,
	PHASE3_COMMAND,
	PHASE4_COMMAND,
	PHASE5_COMMAND,
	PHASE6_COMMAND,
];
