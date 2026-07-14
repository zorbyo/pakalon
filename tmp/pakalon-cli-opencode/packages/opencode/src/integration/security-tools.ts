import { Log } from "../util/log"

const log = Log.create({ service: "integration:security" })

export interface SecurityTool {
  name: string
  type: "sast" | "dast" | "review"
  command: string
  available: "free" | "pro"
  description: string
}

export interface SecurityFinding {
  tool: string
  severity: "high" | "medium" | "low" | "info"
  title: string
  description: string
  file?: string
  line?: number
  recommendation: string
}

export interface SecurityReport {
  tool: string
  timestamp: string
  findings: SecurityFinding[]
  summary: {
    high: number
    medium: number
    low: number
    info: number
  }
  passed: boolean
}

const FREE_TOOLS: SecurityTool[] = [
  { name: "Bandit", type: "sast", command: "bandit", available: "free", description: "Python security linter" },
  { name: "FindSecBugs", type: "sast", command: "findsecbugs", available: "free", description: "Java security analyzer" },
  { name: "Brakeman", type: "sast", command: "brakeman", available: "free", description: "Ruby on Rails security scanner" },
  { name: "ESLint Security", type: "sast", command: "eslint", available: "free", description: "JavaScript/TypeScript security rules" },
  { name: "sqlmap", type: "dast", command: "sqlmap", available: "free", description: "SQL injection detection" },
  { name: "Wapiti", type: "dast", command: "wapiti", available: "free", description: "Web application vulnerability scanner" },
  { name: "XSStrike", type: "dast", command: "xsstrike", available: "free", description: "XSS detection and exploitation" },
]

const PRO_TOOLS: SecurityTool[] = [
  { name: "Semgrep", type: "sast", command: "semgrep", available: "pro", description: "Multi-language static analysis" },
  { name: "SonarQube", type: "sast", command: "sonarqube", available: "pro", description: "Code quality and security" },
  { name: "Gitleaks", type: "sast", command: "gitleaks", available: "pro", description: "Secret detection in git repos" },
  { name: "OWASP ZAP", type: "dast", command: "zap", available: "pro", description: "Web application security scanner" },
  { name: "Nikto", type: "dast", command: "nikto", available: "pro", description: "Web server scanner" },
]

export namespace SecurityTools {
  export function getTools(tier: "free" | "pro" = "free"): SecurityTool[] {
    return tier === "pro" ? [...FREE_TOOLS, ...PRO_TOOLS] : FREE_TOOLS
  }

  export function getToolsByType(type: SecurityTool["type"], tier: "free" | "pro" = "free"): SecurityTool[] {
    return getTools(tier).filter((t) => t.type === type)
  }

  export async function runSAST(
    projectPath: string,
    tools: SecurityTool[] = FREE_TOOLS.filter((t) => t.type === "sast"),
  ): Promise<SecurityReport> {
    log.info("running SAST scan", { path: projectPath, tools: tools.map((t) => t.name) })

    const findings: SecurityFinding[] = []

    for (const tool of tools) {
      try {
        const toolFindings = await runTool(projectPath, tool)
        findings.push(...toolFindings)
      } catch (err) {
        log.warn("tool failed", { tool: tool.name, error: err })
      }
    }

    const summary = {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    }

    return {
      tool: "SAST",
      timestamp: new Date().toISOString(),
      findings,
      summary,
      passed: summary.high === 0,
    }
  }

  export async function runDAST(
    projectPath: string,
    targetUrl: string = "http://localhost:3000",
    tools: SecurityTool[] = FREE_TOOLS.filter((t) => t.type === "dast"),
  ): Promise<SecurityReport> {
    log.info("running DAST scan", { path: projectPath, targetUrl, tools: tools.map((t) => t.name) })

    const findings: SecurityFinding[] = []

    for (const tool of tools) {
      try {
        const toolFindings = await runDASTTool(projectPath, tool, targetUrl)
        findings.push(...toolFindings)
      } catch (err) {
        log.warn("DAST tool failed", { tool: tool.name, error: err })
      }
    }

    const summary = {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    }

    return {
      tool: "DAST",
      timestamp: new Date().toISOString(),
      findings,
      summary,
      passed: summary.high === 0,
    }
  }

  export function formatReport(report: SecurityReport): string {
    const lines = [
      `# Security Report: ${report.tool}`,
      "",
      `## Generated: ${report.timestamp}`,
      "",
      `## Status: ${report.passed ? "✅ PASSED" : "❌ FAILED"}`,
      "",
      "## Summary",
      `- **High:** ${report.summary.high}`,
      `- **Medium:** ${report.summary.medium}`,
      `- **Low:** ${report.summary.low}`,
      `- **Info:** ${report.summary.info}`,
      "",
      "## Findings",
      "",
    ]

    for (const finding of report.findings) {
      const icon =
        finding.severity === "high"
          ? "🔴"
          : finding.severity === "medium"
            ? "🟡"
            : finding.severity === "low"
              ? "🔵"
              : "⚪"

      lines.push(`### ${icon} ${finding.title}`)
      lines.push(`**Severity:** ${finding.severity.toUpperCase()}`)
      lines.push(`**Tool:** ${finding.tool}`)
      if (finding.file) lines.push(`**File:** ${finding.file}${finding.line ? `:${finding.line}` : ""}`)
      lines.push(`**Description:** ${finding.description}`)
      lines.push(`**Recommendation:** ${finding.recommendation}`)
      lines.push("")
    }

    return lines.join("\n")
  }

  async function runTool(projectPath: string, tool: SecurityTool): Promise<SecurityFinding[]> {
    // Mock implementation - in production, this would execute the actual tools
    log.info("running security tool", { tool: tool.name, path: projectPath })

    // Simulate tool execution
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Return mock findings based on tool type
    const mockFindings: SecurityFinding[] = []

    if (tool.name === "ESLint Security") {
      mockFindings.push({
        tool: tool.name,
        severity: "medium",
        title: "Potential XSS vulnerability",
        description: "User input is rendered without sanitization",
        file: "src/components/Input.tsx",
        line: 42,
        recommendation: "Use DOMPurify or similar library to sanitize user input",
      })
    }

    if (tool.name === "Bandit") {
      mockFindings.push({
        tool: tool.name,
        severity: "low",
        title: "Use of exec() detected",
        description: "exec() can execute arbitrary code",
        file: "scripts/build.py",
        line: 15,
        recommendation: "Use subprocess.run() with shell=False instead",
      })
    }

    return mockFindings
  }

  async function runDASTTool(
    projectPath: string,
    tool: SecurityTool,
    targetUrl: string,
  ): Promise<SecurityFinding[]> {
    // Mock implementation
    log.info("running DAST tool", { tool: tool.name, targetUrl })

    await new Promise((resolve) => setTimeout(resolve, 100))

    const mockFindings: SecurityFinding[] = []

    if (tool.name === "sqlmap") {
      mockFindings.push({
        tool: tool.name,
        severity: "high",
        title: "Potential SQL injection",
        description: "Parameter 'id' appears vulnerable to SQL injection",
        recommendation: "Use parameterized queries or ORM",
      })
    }

    if (tool.name === "XSStrike") {
      mockFindings.push({
        tool: tool.name,
        severity: "medium",
        title: "Reflected XSS detected",
        description: "Search parameter reflects user input without encoding",
        recommendation: "Encode output and use Content-Security-Policy headers",
      })
    }

    return mockFindings
  }
}
