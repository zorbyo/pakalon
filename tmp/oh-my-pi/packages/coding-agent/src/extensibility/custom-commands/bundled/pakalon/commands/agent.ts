/**
 * /agent command — Invoke a single dedicated sub-agent with a prompt.
 *
 * Spawns an isolated sub-agent session that receives the given prompt,
 * executes it with full tool access, and returns the result. Useful for
 * delegating focused tasks without starting a full multi-agent pipeline.
 */
import { logger } from "@oh-my-pi/pi-utils";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

export interface AgentTask {
	prompt: string;
	tools?: string[];
	model?: string;
	timeout?: number;
}

export class AgentCommand implements CustomCommand {
	name = "agent";
	description = "Invoke a single dedicated sub-agent with a prompt";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const prompt = args.join(" ").trim();
		if (!prompt) {
			ctx.ui.notify("Usage: /agent <prompt>", "error");
			return [
				"## /agent",
				"",
				"Invoke a single sub-agent with a dedicated task.",
				"",
				"Usage: `/agent <prompt>`",
				"",
				"Example: `/agent Review the error handling in src/api/routes/`",
				"",
				"The agent will execute autonomously and return its findings.",
			].join("\n");
		}

		try {
			logger.info("agent: dispatching single-agent task", { prompt: prompt.slice(0, 100) });
			ctx.ui.notify("Agent task dispatched. Processing...", "info");

			return this.formatAgentTask(prompt);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("agent command failed", { error: msg });
			ctx.ui.notify(`Agent task failed: ${msg}`, "error");
			return undefined;
		}
	}

	private formatAgentTask(prompt: string): string {
		return [
			`## Single Agent Task`,
			``,
			`You are a dedicated coding agent. Execute the following task autonomously:`,
			``,
			prompt,
			``,
			`### Instructions`,
			``,
			`- Use the available tools (read, search, grep, edit, write, bash) as needed.`,
			`- If you need to inspect multiple files, read them in parallel.`,
			`- When finished, provide a concise summary of what you did and what you found.`,
			`- If you encounter errors, diagnose and fix them or report clearly.`,
			``,
			`### Output Requirements`,
			``,
			`1. What was done / investigated`,
			`2. Key findings or results`,
			`3. Any issues encountered and how they were resolved`,
			`4. Action items or recommendations`,
		].join("\n");
	}
}

export default function agentFactory(_api: CustomCommandAPI): AgentCommand {
	return new AgentCommand();
}
