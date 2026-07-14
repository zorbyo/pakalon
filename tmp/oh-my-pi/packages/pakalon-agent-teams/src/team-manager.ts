import { logger } from "@oh-my-pi/pi-utils";
import type { AgentRole, AgentSpec, AgentStatus, AgentTask, AgentTeam } from "./types";

export class TeamManager {
	private teams: Map<string, AgentTeam> = new Map();
	private tasks: Map<string, AgentTask> = new Map();
	private agents: Map<string, AgentSpec> = new Map();

	createTeam(name: string, agents: AgentSpec[]): AgentTeam {
		const team: AgentTeam = {
			id: crypto.randomUUID(),
			name,
			agents,
			createdAt: new Date().toISOString(),
		};
		this.teams.set(team.id, team);
		for (const agent of agents) {
			this.agents.set(agent.id, agent);
		}
		logger.info("Team created", { id: team.id, name, agentCount: agents.length });
		return team;
	}

	registerAgent(agent: AgentSpec): void {
		this.agents.set(agent.id, agent);
	}

	getAgent(id: string): AgentSpec | undefined {
		return this.agents.get(id);
	}

	getAllAgents(): AgentSpec[] {
		return [...this.agents.values()];
	}

	getAgentsByRole(role: AgentRole): AgentSpec[] {
		return this.getAllAgents().filter(a => a.role === role);
	}

	getTeam(id: string): AgentTeam | undefined {
		return this.teams.get(id);
	}

	getAllTeams(): AgentTeam[] {
		return [...this.teams.values()];
	}

	deleteTeam(id: string): boolean {
		return this.teams.delete(id);
	}

	assignTask(agentId: string, description: string): AgentTask {
		const task: AgentTask = {
			id: crypto.randomUUID(),
			agentId,
			description,
			status: "idle",
			assignedAt: new Date().toISOString(),
		};
		this.tasks.set(task.id, task);
		logger.info("Task assigned", { id: task.id, agentId });
		return task;
	}

	updateTaskStatus(taskId: string, status: AgentStatus, result?: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task) return false;
		task.status = status;
		if (status === "completed" || status === "failed") {
			task.completedAt = new Date().toISOString();
		}
		if (result) task.result = result;
		return true;
	}

	getTask(taskId: string): AgentTask | undefined {
		return this.tasks.get(taskId);
	}

	getTasksByAgent(agentId: string): AgentTask[] {
		return [...this.tasks.values()].filter(t => t.agentId === agentId);
	}

	getAllTasks(): AgentTask[] {
		return [...this.tasks.values()];
	}
}
