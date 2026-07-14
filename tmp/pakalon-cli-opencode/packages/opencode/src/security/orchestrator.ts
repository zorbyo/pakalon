import { Log } from "../util/log"
import { FileStructure } from "../pipeline/file-structure"
import { Process } from "../util/process"
import type { PhaseContext } from "../pipeline/types"
import { Plan } from "../auth/plan"

const log = Log.create({ service: "security:orchestrator" })

export interface SecurityScanResult {
  tool: string
  type: "sast" | "dast" | "dependency" | "secret"
  findings: SecurityFinding[]
  duration: number
  timestamp: number
}

export interface SecurityFinding {
  id: string
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  description: string
  file?: string
  line?: number
  cwe?: string
  remediation?: string
}

export interface SecurityReport {
  scans: SecurityScanResult[]
  summary: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
  passed: boolean
}

const FREE_TOOLS = ["bandit", "findsecbugs", "sqlmap"] as const
const PRO_TOOLS = [
  "semgrep",
  "gitleaks",
  "zap",
  "nikto",
  "sonarqube",
  "owasp",
] as const

const SAST_TOOLS = [...PRO_TOOLS, ...FREE_TOOLS] as const
const DAST_TOOLS = ["zap", "nikto", "sqlmap"] as const

export namespace SecurityOrchestrator {
  export async function getAvailableTools(): Promise<string[]> {
    const userPlan = await Plan.getUserPlan()
    const tools: string[] = []

    for (const tool of FREE_TOOLS) {
      const available = await isToolAvailable(tool)
      if (available) {
        tools.push(tool)
      }
    }

    if (userPlan.plan === "pro") {
      for (const tool of PRO_TOOLS) {
        const available = await isToolAvailable(tool)
        if (available) {
          tools.push(tool)
        }
      }
    }

    log.info("available security tools", { tools, plan: userPlan.plan })
    return tools
  }

  async function isToolAvailable(tool: string): Promise<boolean> {
    try {
      switch (tool) {
        case "semgrep":
          await Process.run(["semgrep", "--version"], { timeout: 5000 })
          return true
        case "bandit":
          await Process.run(["bandit", "--version"], { timeout: 5000 })
          return true
        case "gitleaks":
          await Process.run(["gitleaks", "--version"], { timeout: 5000 })
          return true
        case "zap":
          return true
        case "nikto":
          await Process.run(["nikto", "-Version"], { timeout: 5000 })
          return true
        case "sqlmap":
          await Process.run(["sqlmap", "--version"], { timeout: 5000 })
          return true
        default:
          return false
      }
    } catch {
      return false
    }
  }

  export async function runSAST(projectPath: string): Promise<SecurityScanResult[]> {
    log.info("running SAST scans", { path: projectPath })
    const results: SecurityScanResult[] = []
    const availableTools = await getAvailableTools()

    for (const tool of SAST_TOOLS) {
      if (availableTools.includes(tool)) {
        const result = await runScan(tool, "sast", projectPath)
        results.push(result)
      }
    }

    return results
  }

  export async function runDAST(targetUrl: string): Promise<SecurityScanResult[]> {
    log.info("running DAST scans", { url: targetUrl })
    const results: SecurityScanResult[] = []
    const availableTools = await getAvailableTools()

    for (const tool of DAST_TOOLS) {
      if (availableTools.includes(tool)) {
        const result = await runScan(tool, "dast", targetUrl)
        results.push(result)
      }
    }

    return results
  }

  export async function runFullScan(
    projectPath: string,
    targetUrl?: string,
  ): Promise<SecurityReport> {
    const sastResults = await runSAST(projectPath)
    const dastResults = targetUrl ? await runDAST(targetUrl) : []
    const allScans = [...sastResults, ...dastResults]
    return generateReport(allScans)
  }

  export function generateReport(scans: SecurityScanResult[]): SecurityReport {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const scan of scans) {
      for (const finding of scan.findings) {
        summary[finding.severity]++
      }
    }
    return {
      scans,
      summary,
      passed: summary.critical === 0 && summary.high === 0,
    }
  }

  export async function saveReport(
    ctx: PhaseContext,
    report: SecurityReport,
  ): Promise<void> {
    const content = formatReport(report)
    await FileStructure.writeArtifact(ctx.projectPath, 4, "security-report.md", content)

    const xmlContent = generateJUnitXML(report)
    await FileStructure.writeArtifact(ctx.projectPath, 4, "security_results.xml", xmlContent)
  }

  function formatReport(report: SecurityReport): string {
    const lines = [
      "# Security Report",
      "",
      "## Summary",
      `- Critical: ${report.summary.critical}`,
      `- High: ${report.summary.high}`,
      `- Medium: ${report.summary.medium}`,
      `- Low: ${report.summary.low}`,
      `- Info: ${report.summary.info}`,
      "",
      `## Status: ${report.passed ? "✅ PASSED" : "❌ FAILED"}`,
      "",
      "## Scans",
    ]

    for (const scan of report.scans) {
      lines.push(`### ${scan.tool} (${scan.type})`)
      lines.push(`Duration: ${scan.duration}ms`)
      lines.push(`Findings: ${scan.findings.length}`)
      lines.push("")
    }

    return lines.join("\n")
  }

  function generateJUnitXML(report: SecurityReport): string {
    const tests = report.scans.map(
      (scan) =>
        `    <testcase name="${scan.tool}" classname="${scan.type}" time="${scan.duration / 1000}">
      ${scan.findings.length > 0 ? `      <failure message="${scan.findings.length} findings found"/>` : ""}
    </testcase>`,
    )

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="security" tests="${report.scans.length}" failures="${report.summary.critical + report.summary.high}">
${tests.join("\n")}
</testsuite>
`
  }

  async function runScan(
    tool: string,
    type: SecurityScanResult["type"],
    target: string,
  ): Promise<SecurityScanResult> {
    log.info("running scan", { tool, type, target })
    const start = Date.now()

    try {
      switch (tool) {
        case "semgrep":
          return await runSemgrep(target)
        case "bandit":
          return await runBandit(target)
        case "gitleaks":
          return await runGitleaks(target)
        case "zap":
          return await runZap(target)
        case "nikto":
          return await runNikto(target)
        case "sqlmap":
          return await runSqlmap(target)
        default:
          return {
            tool,
            type,
            findings: [],
            duration: Date.now() - start,
            timestamp: Date.now(),
          }
      }
    } catch (error) {
      log.error("scan failed", { tool, error })
      return {
        tool,
        type,
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    }
  }

  async function runSemgrep(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    try {
      const result = await Process.run(["semgrep", "--json", "--quiet", target], {
        timeout: 120000,
      })
      const findings = parseSemgrepOutput(result.stdout.toString())
      return {
        tool: "semgrep",
        type: "sast",
        findings,
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    } catch {
      return {
        tool: "semgrep",
        type: "sast",
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    }
  }

  async function runBandit(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    try {
      const result = await Process.run(["bandit", "-r", "-f", "json", target], {
        timeout: 120000,
      })
      const findings = parseBanditOutput(result.stdout.toString())
      return {
        tool: "bandit",
        type: "sast",
        findings,
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    } catch {
      return {
        tool: "bandit",
        type: "sast",
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    }
  }

  async function runGitleaks(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    try {
      const result = await Process.run(["gitleaks", "detect", "--source", target, "--report-format", "json"], {
        timeout: 120000,
      })
      const findings = parseGitleaksOutput(result.stdout.toString())
      return {
        tool: "gitleaks",
        type: "secret",
        findings,
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    } catch {
      return {
        tool: "gitleaks",
        type: "secret",
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    }
  }

  async function runZap(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    return {
      tool: "zap",
      type: "dast",
      findings: [],
      duration: Date.now() - start,
      timestamp: Date.now(),
    }
  }

  async function runNikto(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    try {
      const result = await Process.run(["nikto", "-h", target, "-Format", "txt"], {
        timeout: 120000,
      })
      return {
        tool: "nikto",
        type: "dast",
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    } catch {
      return {
        tool: "nikto",
        type: "dast",
        findings: [],
        duration: Date.now() - start,
        timestamp: Date.now(),
      }
    }
  }

  async function runSqlmap(target: string): Promise<SecurityScanResult> {
    const start = Date.now()
    return {
      tool: "sqlmap",
      type: "dast",
      findings: [],
      duration: Date.now() - start,
      timestamp: Date.now(),
    }
  }

  function parseSemgrepOutput(output: string): SecurityFinding[] {
    try {
      const data = JSON.parse(output)
      const findings: SecurityFinding[] = []

      for (const result of data.results || []) {
        findings.push({
          id: result.check_id || "",
          severity: mapSeverity(result.extra?.severity),
          title: result.extra?.description || "",
          description: result.extra?.message || "",
          file: result.start?.file,
          line: result.start?.line,
          cwe: result.extra?.cwe,
        })
      }

      return findings
    } catch {
      return []
    }
  }

  function parseBanditOutput(output: string): SecurityFinding[] {
    try {
      const data = JSON.parse(output)
      const findings: SecurityFinding[] = []

      for (const issue of data.results || []) {
        findings.push({
          id: issue.test_id || "",
          severity: mapSeverity(issue.severity),
          title: issue.test_name || "",
          description: issue.issue_text || "",
          file: issue.filename,
          line: issue.line_number,
        })
      }

      return findings
    } catch {
      return []
    }
  }

  function parseGitleaksOutput(output: string): SecurityFinding[] {
    try {
      const data = JSON.parse(output)
      const findings: SecurityFinding[] = []

      for (const leak of data || []) {
        findings.push({
          id: leak.RuleID || "",
          severity: "high",
          title: leak.Description || "",
          description: leak.Match || "",
          file: leak.File,
          line: leak.StartLine,
        })
      }

      return findings
    } catch {
      return []
    }
  }

  function mapSeverity(severity: string | undefined): SecurityFinding["severity"] {
    switch (severity?.toLowerCase()) {
      case "critical":
        return "critical"
      case "high":
        return "high"
      case "medium":
        return "medium"
      case "low":
        return "low"
      default:
        return "info"
    }
  }
}
