/**
 * Agent teams registry for Pakalon.
 * Persists custom agents in `.pakalon/agents/<id>.json` and supports
 * the `/agents` create-wizard + `@<name>` mention resolution.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export interface AgentDefinition {
	id: string;
	name: string;
	description: string;
	color: string;
	tools: string[];
	systemPrompt: string;
	createdAt: string;
	updatedAt: string;
}

const AGENTS_DIR = ".pakalon/agents";

function ensureDir(projectDir: string): string {
	const dir = path.join(projectDir, AGENTS_DIR);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** List all agent definitions for a project. */
export function listAgents(projectDir: string): AgentDefinition[] {
	const dir = path.join(projectDir, AGENTS_DIR);
	if (!fs.existsSync(dir)) return [];
	const out: AgentDefinition[] = [];
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".json")) continue;
		try {
			out.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as AgentDefinition);
		} catch (err) {
			logger.warn("Failed to read agent file", { file, err });
		}
	}
	return out;
}

/** Look up an agent by its `@<name>` handle. */
export function findAgentByName(projectDir: string, name: string): AgentDefinition | null {
	const agents = listAgents(projectDir);
	return agents.find(a => a.name === name || a.id === name) ?? null;
}

/** Persist a new (or update existing) agent. */
export function saveAgent(projectDir: string, agent: AgentDefinition): AgentDefinition {
	const dir = ensureDir(projectDir);
	const file = path.join(dir, `${agent.id}.json`);
	const next: AgentDefinition = { ...agent, updatedAt: new Date().toISOString() };
	fs.writeFileSync(file, JSON.stringify(next, null, 2));
	return next;
}

/** Delete an agent. */
export function deleteAgent(projectDir: string, id: string): boolean {
	const file = path.join(projectDir, AGENTS_DIR, `${id}.json`);
	try {
		fs.unlinkSync(file);
		return true;
	} catch {
		return false;
	}
}

/** Generate a stable id from a name. */
export function deriveId(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || `agent-${Date.now().toString(36)}`
	);
}
