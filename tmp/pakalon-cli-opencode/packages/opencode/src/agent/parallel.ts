import { TeamManager } from "./team"
import { Log } from "../util/log"

const log = Log.create({ service: "agent:parallel" })

interface Task {
  teamId: string
  task: string
}

interface Row {
  team_id: string
  execution_id?: string
  status: "completed" | "failed"
  result: string
  artifacts: string[]
  tokens_used: number
}

interface Result {
  total: number
  success: number
  failed: number
  items: Row[]
}

export namespace ParallelExecutor {
  export async function runParallel(projectPath: string, tasks: Task[]): Promise<Result> {
    if (tasks.length === 0) return { total: 0, success: 0, failed: 0, items: [] }
    const list = await Promise.allSettled(
      tasks.map(async (item) => {
        const exec = await TeamManager.executeTask(projectPath, item.teamId, item.task)
        if (!exec) {
          return {
            team_id: item.teamId,
            status: "failed" as const,
            result: "Team not found",
            artifacts: [],
            tokens_used: 0,
          }
        }
        const out = `Task completed by team ${item.teamId}`
        const done = await TeamManager.completeExecution(exec.id, out, [], 0)
        if (!done) {
          return {
            team_id: item.teamId,
            execution_id: exec.id,
            status: "failed" as const,
            result: "Execution completion failed",
            artifacts: [],
            tokens_used: 0,
          }
        }
        return {
          team_id: item.teamId,
          execution_id: done.id,
          status: "completed" as const,
          result: done.result ?? "",
          artifacts: done.artifacts ?? [],
          tokens_used: done.tokens_used ?? 0,
        }
      }),
    )

    const items = list.map((item, idx) => {
      if (item.status === "fulfilled") return item.value
      return {
        team_id: tasks[idx]?.teamId ?? "unknown",
        status: "failed" as const,
        result: item.reason instanceof Error ? item.reason.message : String(item.reason),
        artifacts: [],
        tokens_used: 0,
      }
    })

    const success = items.filter((item) => item.status === "completed").length
    const failed = items.length - success
    const result = {
      total: items.length,
      success,
      failed,
      items,
    }
    log.info("parallel execution finished", { total: result.total, success: result.success, failed: result.failed })
    return result
  }

  export function formatResults(result: Result) {
    if (result.total === 0) return "No tasks to run"
    const lines = [
      `Parallel run: ${result.success}/${result.total} completed`,
      `Failed: ${result.failed}`,
      "",
    ]
    for (const item of result.items) {
      const mark = item.status === "completed" ? "✓" : "✗"
      lines.push(`${mark} ${item.team_id}`)
      lines.push(`  status: ${item.status}`)
      if (item.execution_id) lines.push(`  execution: ${item.execution_id}`)
      if (item.tokens_used > 0) lines.push(`  tokens: ${item.tokens_used}`)
      lines.push(`  result: ${item.result}`)
      if (item.artifacts.length > 0) lines.push(`  artifacts: ${item.artifacts.join(", ")}`)
      lines.push("")
    }
    return lines.join("\n").trim()
  }
}
