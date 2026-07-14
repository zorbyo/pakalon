import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "../pakalon"
import type { AgentInfo, TeamInfo, AgentTask } from "./types"
import { AGENT_COLORS } from "./types"

const log = Log.create({ service: "agents" })

const DEFAULT_AGENTS: Omit<AgentInfo, "id" | "createdAt">[] = [
  {
    name: "planner",
    description: "Plans project architecture and requirements",
    role: "planner",
    color: AGENT_COLORS[0],
    tools: ["read", "write", "glob", "grep", "websearch"],
    enabled: true,
  },
  {
    name: "designer",
    description: "Creates UI designs and wireframes",
    role: "designer",
    color: AGENT_COLORS[1],
    tools: ["read", "write", "edit", "glob"],
    enabled: true,
  },
  {
    name: "developer",
    description: "Writes code and implements features",
    role: "developer",
    color: AGENT_COLORS[2],
    tools: ["read", "write", "edit", "bash", "glob", "grep"],
    enabled: true,
  },
  {
    name: "tester",
    description: "Tests code and finds bugs",
    role: "tester",
    color: AGENT_COLORS[3],
    tools: ["read", "bash", "glob", "grep"],
    enabled: true,
  },
  {
    name: "reviewer",
    description: "Reviews code for quality and security",
    role: "reviewer",
    color: AGENT_COLORS[4],
    tools: ["read", "grep", "glob"],
    enabled: true,
  },
]

export namespace Agent {
  const registry = new Map<string, AgentInfo>()
  const tasks = new Map<string, AgentTask>()

  export function list(): AgentInfo[] {
    return Array.from(registry.values())
  }

  export function get(id: string): AgentInfo | undefined {
    return registry.get(id)
  }

  export function getByName(name: string): AgentInfo | undefined {
    return Array.from(registry.values()).find(
      (a) => a.name.toLowerCase() === name.toLowerCase(),
    )
  }

  export function create(info: Omit<AgentInfo, "id" | "createdAt">): AgentInfo {
    const agent: AgentInfo = {
      ...info,
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }
    registry.set(agent.id, agent)
    log.info("created agent", { id: agent.id, name: agent.name })
    return agent
  }

  export function update(id: string, updates: Partial<AgentInfo>): AgentInfo | undefined {
    const agent = registry.get(id)
    if (!agent) return undefined
    const updated = { ...agent, ...updates, id: agent.id }
    registry.set(id, updated)
    return updated
  }

  export function remove(id: string): boolean {
    return registry.delete(id)
  }

  export function initDefaults(): void {
    if (registry.size > 0) return
    for (const def of DEFAULT_AGENTS) {
      create(def)
    }
    log.info("initialized default agents", { count: DEFAULT_AGENTS.length })
  }

  export async function saveToFile(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/agents-registry.json`
    const data = {
      agents: Array.from(registry.values()),
      tasks: Array.from(tasks.values()),
    }
    await Filesystem.writeJson(p, data)
    log.info("saved agents registry", { path: p })
  }

  export async function loadFromFile(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/agents-registry.json`
    try {
      const data = await Filesystem.readJson<{ agents: AgentInfo[]; tasks: AgentTask[] }>(p)
      for (const agent of data.agents) {
        registry.set(agent.id, agent)
      }
      for (const task of data.tasks) {
        tasks.set(task.id, task)
      }
      log.info("loaded agents registry", { agents: data.agents.length, tasks: data.tasks.length })
    } catch {
      initDefaults()
    }
  }

  // Task tracking
  export function createTask(agentId: string, description: string): AgentTask {
    const task: AgentTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      description,
      status: "pending",
      startedAt: Date.now(),
    }
    tasks.set(task.id, task)
    return task
  }

  export function updateTask(taskId: string, updates: Partial<AgentTask>): AgentTask | undefined {
    const task = tasks.get(taskId)
    if (!task) return undefined
    const updated = { ...task, ...updates }
    tasks.set(taskId, updated)
    return updated
  }

  export function getTasks(agentId?: string): AgentTask[] {
    const allTasks = Array.from(tasks.values())
    return agentId ? allTasks.filter((t) => t.agentId === agentId) : allTasks
  }
}

export namespace Team {
  const teams = new Map<string, TeamInfo>()

  export function list(): TeamInfo[] {
    return Array.from(teams.values())
  }

  export function get(id: string): TeamInfo | undefined {
    return teams.get(id)
  }

  export function create(name: string, description: string, agentIds: string[]): TeamInfo {
    const agents = agentIds
      .map((id) => Agent.get(id))
      .filter((a): a is AgentInfo => a !== undefined)

    const team: TeamInfo = {
      id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      agents,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    teams.set(team.id, team)
    log.info("created team", { id: team.id, name, agents: agents.length })
    return team
  }

  export function addAgent(teamId: string, agentId: string): boolean {
    const team = teams.get(teamId)
    if (!team) return false
    const agent = Agent.get(agentId)
    if (!agent) return false
    if (team.agents.some((a) => a.id === agentId)) return false
    team.agents.push(agent)
    team.updatedAt = Date.now()
    return true
  }

  export function removeAgent(teamId: string, agentId: string): boolean {
    const team = teams.get(teamId)
    if (!team) return false
    const idx = team.agents.findIndex((a) => a.id === agentId)
    if (idx === -1) return false
    team.agents.splice(idx, 1)
    team.updatedAt = Date.now()
    return true
  }

  export function deleteTeam(id: string): boolean {
    return teams.delete(id)
  }

  export async function saveToFile(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/teams-registry.json`
    const data = Array.from(teams.values())
    await Filesystem.writeJson(p, data)
    log.info("saved teams registry", { path: p })
  }

  export async function loadFromFile(projectPath: string): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/teams-registry.json`
    try {
      const data = await Filesystem.readJson<TeamInfo[]>(p)
      for (const team of data) {
        teams.set(team.id, team)
      }
      log.info("loaded teams registry", { count: data.length })
    } catch {
      // No teams file yet
    }
  }
}

export namespace Runner {
  export interface RunResult {
    agentId: string
    agentName: string
    success: boolean
    output: string
    duration: number
    error?: string
  }

  export interface ExecutionPlan {
    tasks: Array<{
      agentId: string
      prompt: string
      dependsOn: string[]
    }>
  }

  /**
   * Get agent info for execution planning.
   * Actual execution should be done by the AI agent using the task tool.
   */
  export function getAgentForExecution(agentId: string): AgentInfo | undefined {
    return Agent.get(agentId)
  }

  /**
   * Create execution plan for parallel agent runs.
   * The AI agent should use this plan to spawn subagents via the task tool.
   */
  export function createExecutionPlan(agentIds: string[], prompt: string): ExecutionPlan {
    return {
      tasks: agentIds.map((id) => ({
        agentId: id,
        prompt: `[Agent: ${Agent.get(id)?.name || id}] ${prompt}`,
        dependsOn: [],
      })),
    }
  }

  /**
   * Create sequential execution plan with dependencies.
   */
  export function createSequentialPlan(
    agentIds: string[],
    prompt: string,
  ): ExecutionPlan {
    return {
      tasks: agentIds.map((id, index) => ({
        agentId: id,
        prompt: `[Agent: ${Agent.get(id)?.name || id}] ${prompt}`,
        dependsOn: index > 0 ? [agentIds[index - 1]] : [],
      })),
    }
  }

  /**
   * Format execution results for display.
   */
  export function formatResults(results: RunResult[]): string {
    const lines = ["# Execution Results", ""]

    for (const result of results) {
      const status = result.success ? "✅" : "❌"
      lines.push(`## ${status} ${result.agentName}`)
      lines.push(`- Duration: ${result.duration}ms`)
      if (result.error) {
        lines.push(`- Error: ${result.error}`)
      }
      if (result.output) {
        lines.push(`- Output: ${result.output.slice(0, 200)}...`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Get execution summary.
   */
  export function getSummary(results: RunResult[]): {
    total: number
    successful: number
    failed: number
    totalDuration: number
  } {
    return {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
    }
  }
}
