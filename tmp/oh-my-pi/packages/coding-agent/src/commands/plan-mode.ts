/**
 * /plan and /build commands for Pakalon normal-mode SDLC.
 *
 * /plan: Analyze user prompt → generate output.md with implementation plan
 * /build: Execute the plan and start building the application
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import { invokePhaseLLM } from "../pakalon/llm/invoker";
import plannerSystemPrompt from "../prompts/phase-1/planner.md" with { type: "text" };

export const planCommand: CommandEntry = {
	name: "plan",
	description: "Analyze prompt and generate implementation plan (output.md)",
	usage: "/plan <prompt>",
	async execute(args: string[]) {
		const prompt = args.join(" ");
		if (!prompt) {
			return {
				success: false,
				message: "Usage: /plan <project description>\n\nExample: /plan Build a REST API for task management",
			};
		}

		try {
			logger.info("Plan mode: Generating implementation plan", { prompt });

			// Generate plan using Phase 1 planner (lightweight, no full phase 1 artifacts)
			const result = await invokePhaseLLM(
				plannerSystemPrompt,
				JSON.stringify({
					action: "generate_plan_only",
					prompt,
					mode: "plan-mode",
					context: {
						cwd: process.cwd(),
						files: [], // Would scan directory for context
					},
				}),
				{ cwd: process.cwd(), phase: "plan-mode" },
			);

			const planContent = result.text;
			const outputPath = `${process.cwd()}/output.md`;

			// Write plan to output.md
			const fs = await import("node:fs");
			fs.writeFileSync(outputPath, planContent, "utf-8");

			return {
				success: true,
				message:
					`[OK] Plan generated: ${outputPath}\n\n` +
					`Review the plan and make any edits.\n` +
					`When ready, run /build to start implementation.\n\n` +
					`Plan preview (first 500 chars):\n${planContent.slice(0, 500)}...`,
			};
		} catch (error) {
			logger.error("Plan mode failed", { error });
			return { success: false, message: `Plan generation failed: ${error}` };
		}
	},
};

export const buildCommand: CommandEntry = {
	name: "build",
	description: "Execute the plan from /plan and start building",
	usage: "/build",
	async execute(_args: string[]) {
		try {
			const fs = await import("node:fs");

			const outputPath = `${process.cwd()}/output.md`;
			if (!fs.existsSync(outputPath)) {
				return {
					success: false,
					message: "No plan found. Run /plan first to generate output.md",
				};
			}

			const planContent = fs.readFileSync(outputPath, "utf-8");
			logger.info("Build mode: Starting implementation", { planLength: planContent.length });

			// Initialize pakalon-agents if not present
			const pakalonDir = `${process.cwd()}/.pakalon-agents`;
			if (!fs.existsSync(pakalonDir)) {
				fs.mkdirSync(pakalonDir, { recursive: true });
			}

			// Save plan as plan.md in .pakalon-agents
			fs.writeFileSync(`${pakalonDir}/plan.md`, planContent, "utf-8");

			// Generate tasks from plan
			const { runPhase1 } = await import("../phases/phase1");
			const tasksResult = await runPhase1(process.cwd(), {
				prompt: planContent,
				mode: "HIL",
				contextBudgetPct: 65,
			});

			return {
				success: true,
				message:
					`[OK] Build initialized\n\n` +
					`Plan saved to .pakalon-agents/plan.md\n` +
					`Tasks generated: ${tasksResult.tasks.slice(0, 200)}...\n\n` +
					`Next: Run /phase-3 to start development`,
			};
		} catch (error) {
			logger.error("Build mode failed", { error });
			return { success: false, message: `Build failed: ${error}` };
		}
	},
};

export function createPlanModeCommands(): CommandEntry[] {
	return [planCommand, buildCommand];
}
