/**
 * Agent teams management for Pakalon normal mode.
 * Supports @mentions, team definitions, and role-based routing.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type AgentRole =
	| "frontend"
	| "backend"
	| "fullstack"
	| "design"
	| "devops"
	| "security"
	| "testing"
	| "documentation"
	| "custom";

export interface Agent {
	id: string;
	name: string;
	role: AgentRole;
	description: string;
	skills: string[];
	modelId?: string;
	createdAt: string;
	lastActiveAt?: string;
}

export interface Team {
	id: string;
	name: string;
	description: string;
	agents: Agent[];
	createdAt: string;
	updatedAt: string;
}

export interface MentionResult {
	agent: Agent;
	team?: Team;
	message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_AGENTS: Agent[] = [
	{
		id: "frontend",
		name: "Frontend",
		role: "frontend",
		description: "React, Next.js, Tailwind, UI/UX implementation",
		skills: ["react", "nextjs", "tailwind", "css", "html"],
		createdAt: new Date().toISOString(),
	},
	{
		id: "backend",
		name: "Backend",
		role: "backend",
		description: "API design, database, auth, server-side logic",
		skills: ["api", "database", "auth", "nodejs", "python"],
		createdAt: new Date().toISOString(),
	},
	{
		id: "fullstack",
		name: "Fullstack",
		role: "fullstack",
		description: "End-to-end feature implementation",
		skills: ["frontend", "backend", "database", "api"],
		createdAt: new Date().toISOString(),
	},
	{
		id: "devops",
		name: "DevOps",
		role: "devops",
		description: "CI/CD, Docker, deployment, infrastructure",
		skills: ["docker", "ci-cd", "deployment", "infrastructure"],
		createdAt: new Date().toISOString(),
	},
	{
		id: "security",
		name: "Security",
		role: "security",
		description: "Security audits, vulnerability scanning, best practices",
		skills: ["security", "sast", "dast", "vulnerabilities"],
		createdAt: new Date().toISOString(),
	},
];

// ═══════════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════════

function getTeamsFilePath(cwd: string): string {
	return path.join(cwd, ".pakalon", "teams.json");
}

function loadTeams(cwd: string): Team[] {
	try {
		const raw = fs.readFileSync(getTeamsFilePath(cwd), "utf-8");
		return JSON.parse(raw) as Team[];
	} catch {
		return [];
	}
}

function saveTeams(cwd: string, teams: Team[]): void {
	const dir = path.join(cwd, ".pakalon");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(getTeamsFilePath(cwd), JSON.stringify(teams, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all available agents (default + custom).
 */
export function getAgents(cwd: string): Agent[] {
	const teams = loadTeams(cwd);
	const customAgents = teams.flatMap(t => t.agents);
	return [...DEFAULT_AGENTS, ...customAgents];
}

/**
 * Get an agent by ID.
 */
export function getAgent(cwd: string, agentId: string): Agent | undefined {
	return getAgents(cwd).find(a => a.id === agentId);
}

/**
 * Get an agent by name (case-insensitive).
 */
export function getAgentByName(cwd: string, name: string): Agent | undefined {
	const lower = name.toLowerCase();
	return getAgents(cwd).find(a => a.name.toLowerCase() === lower);
}

/**
 * Create a new agent.
 */
export function createAgent(cwd: string, agent: Omit<Agent, "id" | "createdAt">): Agent {
	const id = agent.name.toLowerCase().replace(/\s+/g, "-");
	const newAgent: Agent = {
		...agent,
		id,
		createdAt: new Date().toISOString(),
	};

	// Add to a default "Custom" team or create one
	const teams = loadTeams(cwd);
	let customTeam = teams.find(t => t.id === "custom");
	if (!customTeam) {
		customTeam = {
			id: "custom",
			name: "Custom",
			description: "Custom agent team",
			agents: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		teams.push(customTeam);
	}

	customTeam.agents.push(newAgent);
	customTeam.updatedAt = new Date().toISOString();
	saveTeams(cwd, teams);

	logger.info("Agent created", { id, name: agent.name, role: agent.role });
	return newAgent;
}

/**
 * Delete an agent.
 */
export function deleteAgent(cwd: string, agentId: string): boolean {
	const teams = loadTeams(cwd);
	let deleted = false;

	for (const team of teams) {
		const idx = team.agents.findIndex(a => a.id === agentId);
		if (idx >= 0) {
			team.agents.splice(idx, 1);
			team.updatedAt = new Date().toISOString();
			deleted = true;
		}
	}

	if (deleted) {
		saveTeams(cwd, teams);
		logger.info("Agent deleted", { id: agentId });
	}

	return deleted;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Team management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all teams.
 */
export function getTeams(cwd: string): Team[] {
	return loadTeams(cwd);
}

/**
 * Get a team by ID.
 */
export function getTeam(cwd: string, teamId: string): Team | undefined {
	return loadTeams(cwd).find(t => t.id === teamId);
}

/**
 * Create a new team.
 */
export function createTeam(cwd: string, team: Omit<Team, "id" | "createdAt" | "updatedAt">): Team {
	const id = team.name.toLowerCase().replace(/\s+/g, "-");
	const newTeam: Team = {
		...team,
		id,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	const teams = loadTeams(cwd);
	teams.push(newTeam);
	saveTeams(cwd, teams);

	logger.info("Team created", { id, name: team.name });
	return newTeam;
}

/**
 * Update a team.
 */
export function updateTeam(
	cwd: string,
	teamId: string,
	updates: Partial<Pick<Team, "name" | "description" | "agents">>,
): boolean {
	const teams = loadTeams(cwd);
	const team = teams.find(t => t.id === teamId);
	if (!team) return false;

	if (updates.name) team.name = updates.name;
	if (updates.description) team.description = updates.description;
	if (updates.agents) team.agents = updates.agents;
	team.updatedAt = new Date().toISOString();

	saveTeams(cwd, teams);
	logger.info("Team updated", { id: teamId });
	return true;
}

/**
 * Delete a team.
 */
export function deleteTeam(cwd: string, teamId: string): boolean {
	const teams = loadTeams(cwd);
	const idx = teams.findIndex(t => t.id === teamId);
	if (idx < 0) return false;

	teams.splice(idx, 1);
	saveTeams(cwd, teams);
	logger.info("Team deleted", { id: teamId });
	return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// @mention parsing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse @mentions from a message.
 * Returns matched agents and the cleaned message.
 */
export function parseMentions(cwd: string, message: string): { mentions: Agent[]; cleanedMessage: string } {
	const mentionRegex = /@(\w+)/g;
	const mentions: Agent[] = [];
	const agents = getAgents(cwd);

	let match: RegExpExecArray | null = null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration pattern
	while ((match = mentionRegex.exec(message)) !== null) {
		const name = match[1]!;
		const agent = agents.find(a => a.id === name || a.name.toLowerCase() === name.toLowerCase());
		if (agent && !mentions.some(m => m.id === agent.id)) {
			mentions.push(agent);
		}
	}

	// Remove mentions from message
	const cleanedMessage = message.replace(/@\w+/g, "").trim();

	return { mentions, cleanedMessage };
}

/**
 * Check if a message contains an @mention.
 */
export function hasMention(message: string): boolean {
	return /@\w+/.test(message);
}

/**
 * Route a message to the appropriate agent based on content.
 */
export function routeMessage(cwd: string, message: string): Agent | null {
	const { mentions } = parseMentions(cwd, message);

	// If explicit mention, use that agent
	if (mentions.length > 0) {
		return mentions[0]!;
	}

	// Auto-route based on content keywords
	const lower = message.toLowerCase();

	const keywordMap: Record<AgentRole, string[]> = {
		frontend: ["react", "component", "ui", "css", "tailwind", "button", "form", "layout"],
		backend: ["api", "endpoint", "database", "auth", "server", "middleware"],
		fullstack: ["feature", "app", "application", "full-stack"],
		design: ["design", "wireframe", "mockup", "figma", "ui/ux"],
		devops: ["deploy", "docker", "ci/cd", "pipeline", "kubernetes", "aws"],
		security: ["security", "vulnerability", "audit", "sast", "dast", "scan"],
		testing: ["test", "spec", "coverage", "e2e", "integration"],
		documentation: ["docs", "readme", "documentation", "api docs"],
		custom: [],
	};

	// Find best matching role
	let bestRole: AgentRole | null = null;
	let bestScore = 0;

	for (const [role, keywords] of Object.entries(keywordMap)) {
		const score = keywords.filter(k => lower.includes(k)).length;
		if (score > bestScore) {
			bestScore = score;
			bestRole = role as AgentRole;
		}
	}

	if (bestRole && bestScore > 0) {
		const agents = getAgents(cwd);
		return agents.find(a => a.role === bestRole) ?? null;
	}

	return null;
}

/**
 * Get the default agent for a role.
 */
export function getDefaultAgent(cwd: string, role: AgentRole): Agent | undefined {
	return getAgents(cwd).find(a => a.role === role);
}

/**
 * List all agents formatted for display.
 */
export function formatAgentList(cwd: string): string {
	const agents = getAgents(cwd);
	const lines = ["Available Agents:", "═══════════════════════════════════════"];

	for (const agent of agents) {
		lines.push(`  @${agent.name} (${agent.role})`);
		lines.push(`    ${agent.description}`);
		lines.push(`    Skills: ${agent.skills.join(", ")}`);
		lines.push("");
	}

	lines.push("Usage: @AgentName <message> to route to a specific agent");
	lines.push("Auto-routing: Messages are auto-routed based on content keywords");

	return lines.join("\n");
}
