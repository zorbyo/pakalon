/**
 * Pakalon command - 6-phase autonomous build pipeline.
 *
 * Entry point for the Pakalon bundled command. Registers the /pakalon
 * slash command that initializes and manages the build pipeline.
 */
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";
import { isInitialized } from "./file-structure";
import { executePhase, getPipelineState, getStatusSummary, initializePipeline, resetPipeline } from "./pipeline";
import type { PipelineMode } from "./types";

// ============================================================================
// Subcommand parser
// ============================================================================

interface ParsedArgs {
	subcommand: "init" | "phase" | "status" | "reset" | "help";
	mode: PipelineMode;
	phaseNumber: number;
	maxIterations: number;
	prompt: string;
}

function parseArgs(args: string[]): ParsedArgs {
	const result: ParsedArgs = {
		subcommand: "init",
		mode: "yolo",
		phaseNumber: 1,
		maxIterations: 10,
		prompt: "",
	};

	const positional: string[] = [];
	let i = 0;

	while (i < args.length) {
		const arg = args[i];

		if (arg === "--hil" || arg === "--human") {
			result.mode = "hil";
		} else if (arg === "--yolo") {
			result.mode = "yolo";
		} else if (arg === "--phase" || arg === "-p") {
			const next = args[i + 1];
			if (next) {
				result.phaseNumber = Number.parseInt(next, 10);
				i++;
			}
		} else if (arg === "--iterations" || arg === "-i") {
			const next = args[i + 1];
			if (next) {
				result.maxIterations = Number.parseInt(next, 10);
				i++;
			}
		} else if (arg === "--status" || arg === "-s") {
			result.subcommand = "status";
		} else if (arg === "--reset") {
			result.subcommand = "reset";
		} else if (arg === "--help" || arg === "-h") {
			result.subcommand = "help";
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}

		i++;
	}

	// Determine subcommand from positional args
	if (positional.length > 0) {
		const first = positional[0];
		if (first === "status") {
			result.subcommand = "status";
		} else if (first === "reset") {
			result.subcommand = "reset";
		} else if (first === "help") {
			result.subcommand = "help";
		} else if (first === "phase") {
			result.subcommand = "phase";
			if (positional[1]) {
				result.phaseNumber = Number.parseInt(positional[1], 10);
			}
		} else {
			// Treat as prompt
			result.prompt = positional.join(" ");
		}
	}

	return result;
}

// ============================================================================
// Help text
// ============================================================================

const HELP_TEXT = [
	"Usage: /pakalon [options] [prompt]",
	"",
	"Options:",
	"  --hil, --human     Use Human-in-Loop mode (asks for confirmation)",
	"  --yolo             Use YOLO mode (fully autonomous, default)",
	"  --phase N, -p N    Run a specific phase (1-6)",
	"  --iterations N     Max auditor iterations (default: 10)",
	"  --status, -s       Show pipeline status",
	"  --reset            Reset the pipeline",
	"  --help, -h         Show this help",
	"",
	"Examples:",
	'  /pakalon "Build a SaaS dashboard with Next.js and PostgreSQL"',
	'  /pakalon --hil "Create a todo app with React"',
	"  /pakalon --phase 3",
	"  /pakalon --status",
	"  /pakalon --reset",
	"",
	"Phases:",
	"  1. Planning & Requirements - Research, Q&A, plan files",
	"  2. Wireframes - Penpot wireframes, TDD verification",
	"  3. Development - 5 subagents (Frontend, Backend, Integration, Debug, Review)",
	"  4. Testing & QA - SAST/DAST security scanning (5 subagents)",
	"  5. Deployment - CI/CD, Docker, GitHub PR",
	"  6. Documentation - API docs, README, CHANGELOG",
].join("\n");

// ============================================================================
// PakalonCommand
// ============================================================================

export class PakalonCommand implements CustomCommand {
	name = "pakalon";
	description = "Initialize and manage the 6-phase autonomous build pipeline";

	constructor(private api: CustomCommandAPI) {}

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const parsed = parseArgs(args);

		// Handle subcommands
		switch (parsed.subcommand) {
			case "help":
				ctx.ui.notify(HELP_TEXT, "info");
				return undefined;

			case "status": {
				const status = getStatusSummary();
				ctx.ui.notify(status, "info");
				return undefined;
			}

			case "reset": {
				const confirmed = await ctx.ui.confirm(
					"Reset Pipeline",
					"Are you sure you want to reset the pipeline? This will clear all state.",
				);
				if (!confirmed) {
					ctx.ui.notify("Reset cancelled.", "info");
					return undefined;
				}
				resetPipeline();
				ctx.ui.notify("Pipeline reset. Use /pakalon to start a new build.", "info");
				return undefined;
			}

			case "phase": {
				if (!getPipelineState().initialized) {
					ctx.ui.notify("Pipeline not initialized. Run /pakalon first.", "error");
					return undefined;
				}

				const { result, promptText } = await executePhase(parsed.phaseNumber);
				if (result.status === "failed") {
					ctx.ui.notify(`Phase failed: ${result.errors.join(", ")}`, "error");
					return undefined;
				}

				ctx.ui.notify(`Starting Phase ${parsed.phaseNumber}: ${result.name}`, "info");
				return promptText;
			}
			default:
				break;
		}

		// Initialize or reinitialize pipeline
		const projectPath = this.api.cwd;
		const projectName = parsed.prompt
			? parsed.prompt
					.slice(0, 50)
					.replace(/[^a-zA-Z0-9]/g, "-")
					.replace(/-+/g, "-")
					.toLowerCase()
			: "untitled-project";

		const initialized = await isInitialized(projectPath);

		if (!initialized || parsed.prompt) {
			const { success, error } = await initializePipeline(
				projectPath,
				projectName,
				parsed.mode,
				parsed.maxIterations,
			);

			if (!success) {
				ctx.ui.notify(`Failed to initialize pipeline: ${error}`, "error");
				return undefined;
			}

			if (!initialized) {
				ctx.ui.notify("Pakalon initialized! Created .pakalon-agents/ directory.", "info");
			}
		}

		// If no prompt provided, ask what to build
		if (!parsed.prompt) {
			const userPrompt = await ctx.ui.input(
				"What would you like to build?",
				"Describe your application, tech stack, and any constraints...",
			);

			if (!userPrompt?.trim()) {
				ctx.ui.notify("No prompt provided. Pipeline initialized but no phase started.", "info");
				return undefined;
			}

			parsed.prompt = userPrompt;
		}

		// Start Phase 1 with the user's prompt
		const { result, promptText } = await executePhase(1, parsed.prompt);

		if (result.status === "failed") {
			ctx.ui.notify(`Failed to start pipeline: ${result.errors.join(", ")}`, "error");
			return undefined;
		}

		ctx.ui.notify(`Starting Phase 1: Planning & Requirements`, "info");
		return promptText;
	}
}

// ============================================================================
// Factory
// ============================================================================

export default function pakalonFactory(api: CustomCommandAPI): PakalonCommand {
	return new PakalonCommand(api);
}
