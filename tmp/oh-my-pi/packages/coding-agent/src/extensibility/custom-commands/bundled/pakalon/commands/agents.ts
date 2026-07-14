/**
 * /agents command — Custom user agent team management.
 *
 * Create, list, and use custom AI agents with specific system prompts
 * and tool permissions. Agents can run in parallel via @mentions.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CustomCommand, CustomCommandAPI } from "../../../../extensibility/custom-commands/types";
import type { HookCommandContext } from "../../../../extensibility/hooks/types";

// ============================================================================
// Types
// ============================================================================

interface AgentConfig {
	name: string;
	description: string;
	color: string;
	systemPrompt: string;
	toolsAllowed: string[];
	createdAt: string;
}

// ============================================================================
// Storage
// ============================================================================

function getAgentsDir(): string {
	return path.join(process.env.HOME || process.env.USERPROFILE || "", ".pakalon", "agents");
}

async function loadAgents(): Promise<AgentConfig[]> {
	const agentsDir = getAgentsDir();
	try {
		const files = await fs.readdir(agentsDir);
		const agents: AgentConfig[] = [];
		for (const file of files) {
			if (file.endsWith(".json")) {
				try {
					const content = await Bun.file(path.join(agentsDir, file)).json();
					agents.push(content);
				} catch {
					// Skip invalid files
				}
			}
		}
		return agents;
	} catch {
		return [];
	}
}

async function saveAgent(agent: AgentConfig): Promise<void> {
	const agentsDir = getAgentsDir();
	await fs.mkdir(agentsDir, { recursive: true });
	const filePath = path.join(agentsDir, `${agent.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.json`);
	await Bun.write(filePath, JSON.stringify(agent, null, 2));
}

// ============================================================================
// AgentsCommand
// ============================================================================

export class AgentsCommand implements CustomCommand {
	name = "agents";
	description = "Manage custom AI agent teams (create, list, use)";

	async execute(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const subcommand = args[0]?.toLowerCase();

		switch (subcommand) {
			case "create":
				return this.createAgent(args.slice(1), ctx);
			case "list":
				return this.listAgents(ctx);
			case "use":
				return this.useAgent(args.slice(1), ctx);
			default:
				ctx.ui.notify("Usage: /agents <create|list|use> [args]", "info");
				return undefined;
		}
	}

	private async createAgent(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const name = args[0] || (await ctx.ui.input("Agent name", "e.g., code-reviewer")) || "";
		if (!name.trim()) {
			ctx.ui.notify("Agent name is required.", "error");
			return undefined;
		}

		const description = (await ctx.ui.input("Description", "What does this agent do?")) || "";
		const color = (await ctx.ui.input("Color (for identification)", "e.g., blue, green, red")) || "blue";
		const systemPrompt = (await ctx.ui.input("System prompt", "Instructions for the agent...")) || "";

		const toolsStr =
			(await ctx.ui.input("Allowed tools (comma-separated)", "e.g., read,write,bash or * for all")) || "*";
		const toolsAllowed = toolsStr === "*" ? ["*"] : toolsStr.split(",").map(t => t.trim());

		const agent: AgentConfig = {
			name: name.trim(),
			description: description.trim() || `Custom agent: ${name}`,
			color: color.trim(),
			systemPrompt: systemPrompt.trim() || `You are ${name}, a specialized AI assistant.`,
			toolsAllowed,
			createdAt: new Date().toISOString(),
		};

		await saveAgent(agent);
		ctx.ui.notify(`Agent "${agent.name}" created! Use @${agent.name.toLowerCase()} to invoke it.`, "info");
		return undefined;
	}

	private async listAgents(ctx: HookCommandContext): Promise<string | undefined> {
		const agents = await loadAgents();

		if (agents.length === 0) {
			ctx.ui.notify("No agents created yet. Use /agents create to add one.", "info");
			return undefined;
		}

		const table = [
			"| Name | Description | Tools | Created |",
			"|------|-------------|-------|---------|",
			...agents.map(
				a =>
					`| ${a.name} | ${a.description.slice(0, 40)} | ${a.toolsAllowed.join(", ")} | ${a.createdAt.split("T")[0]} |`,
			),
		].join("\n");

		ctx.ui.notify(table, "info");
		return undefined;
	}

	private async useAgent(args: string[], ctx: HookCommandContext): Promise<string | undefined> {
		const agentName = args[0];
		const prompt = args.slice(1).join(" ");

		if (!agentName) {
			ctx.ui.notify("Usage: /agents use <agent-name> <prompt>", "error");
			return undefined;
		}

		const agents = await loadAgents();
		const agent = agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());

		if (!agent) {
			ctx.ui.notify(`Agent "${agentName}" not found. Use /agents list to see available agents.`, "error");
			return undefined;
		}

		if (!prompt) {
			ctx.ui.notify("Please provide a prompt for the agent.", "error");
			return undefined;
		}

		// Return a prompt that includes the agent's system prompt
		return `You are now acting as agent "${agent.name}" (${agent.description}).

System Prompt: ${agent.systemPrompt}

Allowed Tools: ${agent.toolsAllowed.join(", ")}

Task: ${prompt}

Execute this task according to your system prompt and tool permissions.`;
	}
}

export default function agentsFactory(api: CustomCommandAPI): AgentsCommand {
	return new AgentsCommand(api);
}
