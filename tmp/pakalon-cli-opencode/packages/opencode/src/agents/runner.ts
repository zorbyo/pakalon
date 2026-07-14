import { Log } from "../util/log"
import { Agent, Runner } from "./index"
import type { AgentInfo } from "./types"
import { Session } from "../session"
import { MessageID, PartID, SessionID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "../provider/provider"

const log = Log.create({ service: "agents:runner" })

export interface ExecutionPlan {
  tasks: Array<{
    agentId: string
    prompt: string
    dependsOn: string[]
  }>
}

export interface ExecutionResult {
  planId: string
  results: Runner.RunResult[]
  duration: number
  success: boolean
}

export namespace AgentRunner {
  /**
   * Get execution plan for parallel agent runs.
   * The AI agent should use this to spawn subagents via the task tool.
   */
  export function getParallelExecutionPlan(
    agentIds: string[],
    prompt: string,
  ): ExecutionPlan {
    return Runner.createExecutionPlan(agentIds, prompt)
  }

  /**
   * Get execution plan for sequential agent runs.
   */
  export function getSequentialExecutionPlan(
    agentIds: string[],
    prompt: string,
  ): ExecutionPlan {
    return Runner.createSequentialPlan(agentIds, prompt)
  }

  /**
   * Get agent info for execution.
   */
  export function getAgentInfo(agentId: string): AgentInfo | undefined {
    return Agent.get(agentId)
  }

  /**
   * List available agents for a specific role.
   */
  export function getAgentsByRole(role: string): AgentInfo[] {
    return Agent.list().filter((a) => a.role === role)
  }

  /**
   * Format execution plan for display.
   */
  export function formatExecutionPlan(plan: ExecutionPlan): string {
    const lines = ["# Execution Plan", ""]

    for (const task of plan.tasks) {
      const agent = Agent.get(task.agentId)
      const deps = task.dependsOn.length > 0
        ? ` (depends on: ${task.dependsOn.join(", ")})`
        : " (no dependencies)"

      lines.push(`## ${agent?.name || task.agentId}${deps}`)
      lines.push(`Prompt: ${task.prompt.slice(0, 100)}...`)
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Validate execution plan dependencies.
   */
  export function validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const agentIds = new Set(plan.tasks.map((t) => t.agentId))

    for (const task of plan.tasks) {
      for (const dep of task.dependsOn) {
        if (!agentIds.has(dep)) {
          errors.push(`Task ${task.agentId} depends on ${dep} which is not in the plan`)
        }
      }
    }

    // Check for circular dependencies (simple check)
    for (const task of plan.tasks) {
      if (task.dependsOn.includes(task.agentId)) {
        errors.push(`Task ${task.agentId} depends on itself`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Execute a parallel execution plan by spawning subagent sessions.
   * Tasks with no dependencies run in parallel; dependent tasks wait.
   */
  export async function executeParallel(
    plan: ExecutionPlan,
    parentSessionId: string,
  ): Promise<ExecutionResult> {
    const planId = `exec-${Date.now()}`
    const start = Date.now()
    log.info("executing parallel plan", { planId, tasks: plan.tasks.length })

    const validation = validatePlan(plan)
    if (!validation.valid) {
      return {
        planId,
        results: [],
        duration: Date.now() - start,
        success: false,
      }
    }

    // Group tasks by dependency level
    const levels = groupByDependencyLevel(plan.tasks)
    const allResults: Runner.RunResult[] = []

    for (const level of levels) {
      log.info("executing dependency level", { levelSize: level.length })

      const promises = level.map(async (task) => {
        const agent = Agent.get(task.agentId)
        if (!agent) {
          return {
            agentId: task.agentId,
            agentName: task.agentId,
            success: false,
            output: "",
            duration: 0,
            error: `Agent ${task.agentId} not found`,
          }
        }

        const taskStart = Date.now()
        try {
          const session = await Session.create({
            parentID: SessionID.make(parentSessionId),
            title: `${agent.name} task`,
            permission: [],
          })

          // Send the prompt to the subagent session
          const message: MessageV2.User = {
            id: MessageID.ascending(),
            role: "user",
            sessionID: session.id,
            time: { created: Date.now() },
            agent: task.agentId,
            model: await Provider.defaultModel(),
          }
          await Session.updateMessage(message)
          await Session.updatePart({
            id: PartID.ascending(),
            messageID: message.id,
            sessionID: session.id,
            type: "text",
            text: task.prompt,
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            agentId: task.agentId,
            agentName: agent.name,
            success: true,
            output: `Task submitted to session ${session.id}`,
            duration: Date.now() - taskStart,
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          log.error("task execution failed", { agent: agent.name, error })
          return {
            agentId: task.agentId,
            agentName: agent.name,
            success: false,
            output: "",
            duration: Date.now() - taskStart,
            error,
          }
        }
      })

      const levelResults = await Promise.all(promises)
      allResults.push(...levelResults)
    }

    const duration = Date.now() - start
    const success = allResults.every((r) => r.success)

    log.info("parallel execution completed", {
      planId,
      total: allResults.length,
      successful: allResults.filter((r) => r.success).length,
      failed: allResults.filter((r) => !r.success).length,
      duration,
    })

    return { planId, results: allResults, duration, success }
  }

  function groupByDependencyLevel(
    tasks: ExecutionPlan["tasks"],
  ): Array<ExecutionPlan["tasks"][number][]> {
    const levels: Array<ExecutionPlan["tasks"][number][]> = []
    const assigned = new Set<string>()

    while (assigned.size < tasks.length) {
      const level = tasks.filter(
        (t) => !assigned.has(t.agentId) && t.dependsOn.every((d) => assigned.has(d)),
      )
      if (level.length === 0) break // Circular dependency or error
      levels.push(level)
      for (const t of level) assigned.add(t.agentId)
    }

    return levels
  }
}
