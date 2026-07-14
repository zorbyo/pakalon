import * as path from "node:path";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// BuildCommand
// ============================================================================

export class BuildCommand implements CustomCommand {
	name = "build";
	description = "Start building the application from the planning document";

	constructor(private api: CustomCommandAPI) {}

	async execute(_args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const projectPath = this.api.cwd;
		let planContent = "";
		let planSource = "";

		// Try output.md first (from /plan command)
		const outputPath = path.join(projectPath, "output.md");
		try {
			planContent = await Bun.file(outputPath).text();
			planSource = "output.md";
		} catch {
			// output.md doesn't exist, try plan.md
		}

		// Try .pakalon/plan.md (from /init command)
		if (!planContent) {
			const pakalonPlanPath = path.join(projectPath, ".pakalon", "plan.md");
			try {
				planContent = await Bun.file(pakalonPlanPath).text();
				planSource = ".pakalon/plan.md";
			} catch {
				// plan.md doesn't exist either
			}
		}

		// Try .pakalon-agents/ai-agents/phase-1/plan.md (from /pakalon command)
		if (!planContent) {
			const phase1PlanPath = path.join(projectPath, ".pakalon-agents", "ai-agents", "phase-1", "plan.md");
			try {
				planContent = await Bun.file(phase1PlanPath).text();
				planSource = ".pakalon-agents/ai-agents/phase-1/plan.md";
			} catch {
				// phase-1 plan.md doesn't exist
			}
		}

		if (!planContent) {
			ctx.ui.notify("No planning document found. Run /plan or /init first.", "error");
			return undefined;
		}

		// Also read task.md if available
		let taskContent = "";
		const taskPaths = [
			path.join(projectPath, "task.md"),
			path.join(projectPath, ".pakalon", "task.md"),
			path.join(projectPath, ".pakalon-agents", "ai-agents", "phase-1", "tasks.md"),
		];

		for (const taskPath of taskPaths) {
			try {
				taskContent = await Bun.file(taskPath).text();
				break;
			} catch {}
		}

		ctx.ui.notify(`Building from ${planSource}...`, "info");

		// Construct the build prompt
		const buildPrompt = [
			`## Build Context`,
			``,
			`You are building an application based on the following plan.`,
			`Read the plan carefully and implement all features described.`,
			``,
			`### Plan (${planSource}):`,
			planContent,
			"",
			taskContent ? `### Tasks:\n${taskContent}` : "",
			"",
			`### Instructions:`,
			`1. Follow the plan exactly`,
			`2. Create all necessary files and directories`,
			`3. Implement all features described`,
			`4. Ensure the application is production-ready`,
			`5. Write clean, maintainable code`,
		].join("\n");

		// Return as a prompt to the LLM
		return buildPrompt;
	}
}

export default function buildFactory(api: CustomCommandAPI): BuildCommand {
	return new BuildCommand(api);
}
