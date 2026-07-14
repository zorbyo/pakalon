import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "../pakalon"
import type { TeamInfo, AgentInfo } from "./types"
import { Agent, Team, Runner } from "./index"
import { AgentRunner, type ExecutionResult } from "./runner"

const log = Log.create({ service: "agents:team" })

export interface AgentTeamConfig {
  name: string
  description: string
  color: string
  systemPrompt: string
  tools: string[]
  parentId?: string
}

export interface AgentResult {
  agentName: string
  success: boolean
  output: string
  duration: number
  error?: string
}

export namespace TeamManager {
  export async function createFromPrompt(projectPath: string, prompt: string): Promise<TeamInfo> {
    Agent.initDefaults()
    const agents = Agent.list()
    const selected = agents.slice(0, 3)

    const team = Team.create(
      `team-${Date.now().toString(36)}`,
      prompt.slice(0, 200),
      selected.map((a) => a.id),
    )

    await Agent.saveToFile(projectPath)
    log.info("team created from prompt", { teamId: team.id, agents: selected.length })
    return team
  }

  export async function createAgent(config: AgentTeamConfig): Promise<AgentInfo> {
    log.info("creating agent", { name: config.name })

    const agent = Agent.create({
      name: config.name,
      description: config.description,
      role: "custom",
      color: config.color,
      systemPrompt: config.systemPrompt,
      tools: config.tools,
      enabled: true,
      parentId: config.parentId,
    })

    return agent
  }

  export async function createTeam(
    name: string,
    agentIds: string[],
  ): Promise<TeamInfo> {
    log.info("creating team", { name, agents: agentIds.length })

    const team = Team.create(
      `team-${Date.now().toString(36)}`,
      name,
      agentIds,
    )

    return team
  }

  export function listAgents(teamId: string): AgentInfo[] {
    const team = Team.get(teamId)
    return team?.agents ?? []
  }

  export function listAllAgents(): AgentInfo[] {
    return Agent.list()
  }

  export function listAllTeams(): TeamInfo[] {
    return Team.list()
  }

  export async function removeAgent(agentId: string): Promise<boolean> {
    log.info("removing agent", { agentId })
    return Agent.remove(agentId)
  }

  export async function removeTeam(teamId: string): Promise<boolean> {
    log.info("removing team", { teamId })
    return Team.deleteTeam(teamId)
  }

  export async function saveToFile(projectPath: string): Promise<void> {
    await Agent.saveToFile(projectPath)
    await Team.saveToFile(projectPath)
    log.info("saved agents and teams to file")
  }

  export async function loadFromFile(projectPath: string): Promise<void> {
    await Agent.loadFromFile(projectPath)
    await Team.loadFromFile(projectPath)
    log.info("loaded agents and teams from file")
  }

  export function findAgentByName(name: string): AgentInfo | undefined {
    return Agent.getByName(name)
  }

  export function getAgentsByParent(parentId: string): AgentInfo[] {
    return Agent.list().filter((a) => a.parentId === parentId)
  }

  export function generateTeamReport(teamId: string): string {
    const team = Team.get(teamId)
    if (!team) return "Team not found"

    const lines = [
      `# Team: ${team.name}`,
      "",
      `**ID:** ${team.id}`,
      `**Agents:** ${team.agents.length}`,
      "",
      "## Agents",
      "",
    ]

    for (const agent of team.agents) {
      const agentInfo = Agent.get(agent.id)
      if (agentInfo) {
        lines.push(`### ${agentInfo.name}`)
        lines.push(`- Description: ${agentInfo.description}`)
        lines.push(`- Color: ${agentInfo.color}`)
        lines.push(`- Tools: ${agentInfo.tools.join(", ")}`)
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  /**
   * Create an execution plan for the team.
   * The AI agent should use this plan to spawn subagents via the task tool.
   */
  export function createTeamExecutionPlan(
    teamId: string,
    task: string,
  ): Runner.ExecutionPlan | null {
    const team = Team.get(teamId)
    if (!team) return null

    const agentIds = team.agents.map((a) => a.id)
    return Runner.createExecutionPlan(agentIds, task)
  }

  /**
   * Create a sequential execution plan for the team.
   */
  export function createSequentialExecutionPlan(
    teamId: string,
    task: string,
  ): Runner.ExecutionPlan | null {
    const team = Team.get(teamId)
    if (!team) return null

    const agentIds = team.agents.map((a) => a.id)
    return Runner.createSequentialPlan(agentIds, task)
  }

  /**
   * Get team status for display.
   */
  export function getTeamStatus(teamId: string): {
    team: TeamInfo
    agentCount: number
    agents: Array<{ name: string; role: string; enabled: boolean }>
  } | null {
    const team = Team.get(teamId)
    if (!team) return null

    return {
      team,
      agentCount: team.agents.length,
      agents: team.agents.map((a) => ({
        name: a.name,
        role: a.role,
        enabled: a.enabled,
      })),
    }
  }

  /**
   * Execute a task with a team using parallel subagent spawning.
   * Creates an execution plan and runs all agents in parallel (respecting dependencies).
   */
  export async function executeTeamTask(
    teamId: string,
    task: string,
    parentSessionId: string,
  ): Promise<ExecutionResult | null> {
    const plan = createTeamExecutionPlan(teamId, task)
    if (!plan) {
      log.error("failed to create execution plan", { teamId })
      return null
    }

    log.info("executing team task", { teamId, agents: plan.tasks.length })
    return AgentRunner.executeParallel(plan, parentSessionId)
  }

  /**
   * List executions for a team (from saved results).
   */
  export async function listExecutions(
    projectPath: string,
    teamId?: string,
  ): Promise<ExecutionResult[]> {
    // Load execution results from project storage
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/team-executions.json`
    try {
      const data = await Filesystem.readJson<ExecutionResult[]>(p)
      if (teamId) {
        return data.filter((e) => e.planId.includes(teamId))
      }
      return data
    } catch {
      return []
    }
  }
}
