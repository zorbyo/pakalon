import { SecurityOrchestrator } from "./orchestrator"
import { SecurityParser } from "./parser"
import { SecurityReportFormatter } from "./report"
import { Log } from "../util/log"

const log = Log.create({ service: "security" })

export namespace Security {
  export async function scanProject(projectPath: string, targetUrl?: string): Promise<void> {
    log.info("starting security scan", { projectPath })
    const report = await SecurityOrchestrator.runFullScan(projectPath, targetUrl)
    const markdown = SecurityReportFormatter.toMarkdown(report)
    log.info("security scan completed", { passed: report.passed })
  }
}

export { SecurityOrchestrator } from "./orchestrator"
export { SecurityParser } from "./parser"
export { SecurityReportFormatter } from "./report"
export type { SecurityReport, SecurityFinding, SecurityScanResult } from "./orchestrator"
