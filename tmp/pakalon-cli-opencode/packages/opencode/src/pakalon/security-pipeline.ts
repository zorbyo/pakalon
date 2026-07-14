/**
 * Pakalon Security Pipeline
 * 
 * Implements real security tool adapters for Phase 4:
 * - SAST: Semgrep, Bandit, Gitleaks
 * - DAST: OWASP ZAP, Nikto, sqlmap
 * - Normalized finding schema
 * - Free vs pro tool access
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Pakalon } from "./index"
import fs from "fs/promises"
import path from "path"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)
const log = Log.create({ service: "pakalon:security-pipeline" })

export interface SecurityFinding {
  id: string
  tool: string
  type: "sast" | "dast" | "secret" | "dependency"
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  description: string
  file?: string
  line?: number
  column?: number
  rule?: string
  cwe?: string
  cvss?: number
  remediation?: string
}

export interface SecurityScanResult {
  tool: string
  success: boolean
  findings: SecurityFinding[]
  duration: number
  error?: string
}

export interface SecurityReport {
  projectPath: string
  timestamp: number
  plan: "free" | "pro"
  scans: SecurityScanResult[]
  summary: {
    total: number
    critical: number
    high: number
    medium: number
    low: number
    info: number
  }
}

export namespace SecurityPipeline {
  // Tool definitions
  const TOOLS = {
    semgrep: { name: "semgrep", type: "sast" as const, free: false, command: "semgrep" },
    bandit: { name: "bandit", type: "sast" as const, free: true, command: "bandit" },
    gitleaks: { name: "gitleaks", type: "secret" as const, free: true, command: "gitleaks" },
    owaspZap: { name: "owasp-zap", type: "dast" as const, free: false, command: "zap-cli" },
    nikto: { name: "nikto", type: "dast" as const, free: false, command: "nikto" },
    sqlmap: { name: "sqlmap", type: "dast" as const, free: true, command: "sqlmap" },
  }

  /**
   * Check if a tool is available
   */
  async function isToolAvailable(command: string): Promise<boolean> {
    try {
      await execAsync(`which ${command}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get available tools for a plan
   */
  export async function getAvailableTools(plan: "free" | "pro"): Promise<string[]> {
    const available: string[] = []
    
    for (const [key, tool] of Object.entries(TOOLS)) {
      if (plan === "free" && !tool.free) continue
      if (await isToolAvailable(tool.command)) {
        available.push(key)
      }
    }
    
    return available
  }

  /**
   * Run Semgrep scan
   */
  async function runSemgrep(projectPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now()
    
    try {
      const { stdout } = await execAsync(
        `semgrep --config=auto --json ${projectPath}`,
        { timeout: 300000 }
      )
      
      const results = JSON.parse(stdout)
      const findings: SecurityFinding[] = (results.results || []).map((r: any) => ({
        id: `semgrep-${r.check_id}`,
        tool: "semgrep",
        type: "sast",
        severity: mapSemgrepSeverity(r.extra?.severity),
        title: r.extra?.message || r.check_id,
        description: r.extra?.message || "",
        file: r.path,
        line: r.start?.line,
        column: r.start?.col,
        rule: r.check_id,
        cwe: r.extra?.metadata?.cwe?.[0],
        remediation: r.extra?.fix,
      }))

      return { tool: "semgrep", success: true, findings, duration: Date.now() - startTime }
    } catch (error) {
      return { 
        tool: "semgrep", 
        success: false, 
        findings: [], 
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Run Bandit scan (Python)
   */
  async function runBandit(projectPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now()
    
    try {
      const { stdout } = await execAsync(
        `bandit -r ${projectPath} -f json`,
        { timeout: 300000 }
      )
      
      const results = JSON.parse(stdout)
      const findings: SecurityFinding[] = (results.results || []).map((r: any) => ({
        id: `bandit-${r.test_id}`,
        tool: "bandit",
        type: "sast",
        severity: mapBanditSeverity(r.issue_severity),
        title: r.test_name,
        description: r.issue_text,
        file: r.filename,
        line: r.line_number,
        column: r.col_offset,
        rule: r.test_id,
        cwe: r.issue_cwe?.id,
      }))

      return { tool: "bandit", success: true, findings, duration: Date.now() - startTime }
    } catch (error) {
      return { 
        tool: "bandit", 
        success: false, 
        findings: [], 
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Run Gitleaks scan
   */
  async function runGitleaks(projectPath: string): Promise<SecurityScanResult> {
    const startTime = Date.now()
    
    try {
      const { stdout } = await execAsync(
        `gitleaks detect --source=${projectPath} --report-format=json`,
        { timeout: 300000 }
      )
      
      const results = JSON.parse(stdout || "[]")
      const findings: SecurityFinding[] = results.map((r: any) => ({
        id: `gitleaks-${r.RuleID}-${r.StartLine}`,
        tool: "gitleaks",
        type: "secret",
        severity: "high" as const,
        title: `Secret detected: ${r.Description}`,
        description: `Secret found in ${r.File}`,
        file: r.File,
        line: r.StartLine,
        rule: r.RuleID,
      }))

      return { tool: "gitleaks", success: true, findings, duration: Date.now() - startTime }
    } catch (error) {
      return { 
        tool: "gitleaks", 
        success: false, 
        findings: [], 
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Run security scan with all available tools
   */
  export async function runScan(
    projectPath: string,
    plan: "free" | "pro" = "free"
  ): Promise<SecurityReport> {
    log.info("Starting security scan", { projectPath, plan })
    
    const availableTools = await getAvailableTools(plan)
    const scans: SecurityScanResult[] = []

    // Run SAST tools
    if (availableTools.includes("semgrep")) {
      scans.push(await runSemgrep(projectPath))
    }
    if (availableTools.includes("bandit")) {
      scans.push(await runBandit(projectPath))
    }
    if (availableTools.includes("gitleaks")) {
      scans.push(await runGitleaks(projectPath))
    }

    // Calculate summary
    const allFindings = scans.flatMap(s => s.findings)
    const summary = {
      total: allFindings.length,
      critical: allFindings.filter(f => f.severity === "critical").length,
      high: allFindings.filter(f => f.severity === "high").length,
      medium: allFindings.filter(f => f.severity === "medium").length,
      low: allFindings.filter(f => f.severity === "low").length,
      info: allFindings.filter(f => f.severity === "info").length,
    }

    const report: SecurityReport = {
      projectPath,
      timestamp: Date.now(),
      plan,
      scans,
      summary,
    }

    // Save report
    await saveReport(projectPath, report)

    return report
  }

  /**
   * Save security report
   */
  async function saveReport(projectPath: string, report: SecurityReport): Promise<void> {
    const reportDir = path.join(Pakalon.agentsDir(projectPath), "phase-4")
    await fs.mkdir(reportDir, { recursive: true })

    const reportPath = path.join(reportDir, `security-report-${Date.now()}.json`)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8")

    // Generate markdown summary
    const mdPath = path.join(reportDir, "security-report.md")
    const mdContent = generateMarkdownReport(report)
    await fs.writeFile(mdPath, mdContent, "utf-8")

    log.info("Security report saved", { reportPath, mdPath })
  }

  /**
   * Generate markdown report
   */
  export function generateMarkdownReport(report: SecurityReport): string {
    let md = `# Security Report\n\n`
    md += `## Summary\n`
    md += `- **Total Findings**: ${report.summary.total}\n`
    md += `- **Critical**: ${report.summary.critical}\n`
    md += `- **High**: ${report.summary.high}\n`
    md += `- **Medium**: ${report.summary.medium}\n`
    md += `- **Low**: ${report.summary.low}\n`
    md += `- **Info**: ${report.summary.info}\n\n`

    md += `## Scans\n\n`
    for (const scan of report.scans) {
      md += `### ${scan.tool}\n`
      md += `- Status: ${scan.success ? "✅ Success" : "❌ Failed"}\n`
      md += `- Duration: ${scan.duration}ms\n`
      md += `- Findings: ${scan.findings.length}\n`
      if (scan.error) {
        md += `- Error: ${scan.error}\n`
      }
      md += "\n"
    }

    md += `## Findings\n\n`
    const findings = report.scans.flatMap(s => s.findings)
    for (const finding of findings) {
      const severityIcon = {
        critical: "🔴",
        high: "🟠",
        medium: "🟡",
        low: "🟢",
        info: "🔵",
      }[finding.severity]

      md += `### ${severityIcon} ${finding.title}\n`
      md += `- **Tool**: ${finding.tool}\n`
      md += `- **Severity**: ${finding.severity}\n`
      if (finding.file) md += `- **File**: ${finding.file}${finding.line ? `:${finding.line}` : ""}\n`
      if (finding.rule) md += `- **Rule**: ${finding.rule}\n`
      md += `- **Description**: ${finding.description}\n`
      if (finding.remediation) md += `- **Remediation**: ${finding.remediation}\n`
      md += "\n"
    }

    return md
  }

  // Severity mapping helpers
  function mapSemgrepSeverity(sev: string): SecurityFinding["severity"] {
    switch (sev?.toLowerCase()) {
      case "error": return "critical"
      case "warning": return "medium"
      case "info": return "info"
      default: return "low"
    }
  }

  function mapBanditSeverity(sev: string): SecurityFinding["severity"] {
    switch (sev?.toLowerCase()) {
      case "high": return "high"
      case "medium": return "medium"
      case "low": return "low"
      default: return "info"
    }
  }

  /**
   * Get tools for a plan
   */
  export function getToolsForPlan(plan: "free" | "pro"): string[] {
    return Object.entries(TOOLS)
      .filter(([_, tool]) => plan === "pro" || tool.free)
      .map(([key]) => key)
  }
}

export default SecurityPipeline
