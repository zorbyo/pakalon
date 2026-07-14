import { z } from "zod";

export type AgentRole = "frontend" | "backend" | "integration" | "debug" | "review" | "general";
export type AgentStatus = "idle" | "working" | "completed" | "failed";

export interface AgentSpec {
	id: string;
	name: string;
	role: AgentRole;
	model: string;
	systemPrompt: string;
	allowedTools: string[];
}

export interface AgentTeam {
	id: string;
	name: string;
	agents: AgentSpec[];
	createdAt: string;
}

export interface AgentTask {
	id: string;
	agentId: string;
	description: string;
	status: AgentStatus;
	assignedAt: string;
	completedAt?: string;
	result?: string;
}

export const AgentSpecSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: z.enum(["frontend", "backend", "integration", "debug", "review", "general"]),
	model: z.string(),
	systemPrompt: z.string(),
	allowedTools: z.array(z.string()),
});

export const AgentTeamSchema = z.object({
	id: z.string(),
	name: z.string(),
	agents: z.array(AgentSpecSchema),
	createdAt: z.string(),
});
