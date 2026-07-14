import { Log } from "../util/log"
import { FileStructure } from "./file-structure"
import type { PhaseNumber } from "../pakalon"

const logger = Log.create({ service: "pipeline:execution-logger" })

export interface LogEntry {
  timestamp: string
  phase: number
  event: string
  details: Record<string, unknown>
}

export namespace ExecutionLogger {
  export async function log(
    projectPath: string,
    phase: PhaseNumber,
    event: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      phase,
      event,
      details,
    }

    logger.info("execution event", entry)

    // Append to execution_log.md
    const content = formatLogEntry(entry)
    const logPath = `${projectPath}/.pakalon-agents/ai-agents/phase-3/execution_log.md`

    try {
      const fs = await import("fs/promises")
      const existing = await fs.readFile(logPath, "utf-8").catch(() => "")
      const header = existing.includes("# Execution Log") ? "" : "# Execution Log\n\n"
      await fs.writeFile(logPath, header + existing + content + "\n", "utf-8")
    } catch (err) {
      logger.error("failed to write execution log", { error: err })
    }
  }

  export async function getLog(projectPath: string): Promise<string> {
    const logPath = `${projectPath}/.pakalon-agents/ai-agents/phase-3/execution_log.md`
    try {
      const fs = await import("fs/promises")
      return await fs.readFile(logPath, "utf-8")
    } catch {
      return ""
    }
  }

  export async function clearLog(projectPath: string): Promise<void> {
    const logPath = `${projectPath}/.pakalon-agents/ai-agents/phase-3/execution_log.md`
    await FileStructure.writeArtifact(projectPath, 3, "execution_log.md", "# Execution Log\n\n")
  }

  function formatLogEntry(entry: LogEntry): string {
    const detailsStr = Object.entries(entry.details)
      .map(([k, v]) => `  - ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("\n")

    return `## [${entry.timestamp}] Phase ${entry.phase} - ${entry.event}
${detailsStr}
`
  }
}
