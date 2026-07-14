/**
 * `@<name>` mention parser for Pakalon.
 * Resolves mentioned agent teams in a user message and returns the
 * corresponding system-prompt preludes. The main agent then runs the
 * referenced agents in parallel using the existing `task/` subagent
 * infrastructure.
 */

import { logger } from "@oh-my-pi/pi-utils";
import { type AgentDefinition, findAgentByName } from "./registry";

const MENTION_RE = /@([a-zA-Z0-9_-]{1,32})/g;

export interface ResolvedMention {
	agent: AgentDefinition;
	start: number;
	end: number;
}

/** Extract all unique `@<name>` mentions from a message. */
export function parseMentions(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	MENTION_RE.lastIndex = 0;
	for (;;) {
		const m = MENTION_RE.exec(text);
		if (m === null) break;
		const name = m[1]!;
		if (!seen.has(name)) {
			seen.add(name);
			out.push(name);
		}
	}
	return out;
}

/** Resolve mentions to actual agent definitions in the project. */
export function resolveMentions(projectDir: string, text: string): ResolvedMention[] {
	const out: ResolvedMention[] = [];
	for (const m of text.matchAll(MENTION_RE)) {
		const name = m[1]!;
		const agent = findAgentByName(projectDir, name);
		if (agent) {
			out.push({ agent, start: m.index!, end: m.index! + m[0].length });
		}
	}
	return out;
}

/**
 * Build the system-message prelude for the LLM call: a list of agent
 * definitions that the model should treat as parallel collaborators.
 */
export function buildAgentTeamPrelude(mentions: ResolvedMention[]): string {
	if (mentions.length === 0) return "";
	const lines: string[] = [
		"# Parallel Agent Team (Pakalon)",
		"The following agent teams were @-mentioned in the user message. Treat their roles as parallel collaborators; do not run their bodies sequentially — each will be spawned as a worktree-isolated sub-agent and their outputs streamed back to you.",
		"",
	];
	for (const { agent } of mentions) {
		lines.push(`## @${agent.name} (${agent.id})`);
		lines.push(`Description: ${agent.description}`);
		lines.push(`Allowed tools: ${agent.tools.join(", ") || "(all)"}`);
		lines.push("System prompt:");
		lines.push("```");
		lines.push(agent.systemPrompt);
		lines.push("```");
		lines.push("");
	}
	logger.debug("agent-teams: built prelude", { count: mentions.length, ids: mentions.map(m => m.agent.id) });
	return lines.join("\n");
}
