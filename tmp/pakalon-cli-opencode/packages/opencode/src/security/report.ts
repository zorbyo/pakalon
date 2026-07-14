import { Log } from "../util/log"
import type { SecurityReport, SecurityFinding } from "./orchestrator"

const log = Log.create({ service: "security:report" })

export namespace SecurityReportFormatter {
  export function toMarkdown(report: SecurityReport): string {
    const lines: string[] = [
      "# Security Scan Report",
      "",
      `**Date:** ${new Date().toISOString()}`,
      `**Status:** ${report.passed ? "PASSED" : "FAILED"}`,
      "",
      "## Summary",
      "",
      `| Severity | Count |`,
      `|----------|-------|`,
      `| Critical | ${report.summary.critical} |`,
      `| High | ${report.summary.high} |`,
      `| Medium | ${report.summary.medium} |`,
      `| Low | ${report.summary.low} |`,
      `| Info | ${report.summary.info} |`,
      "",
      "## Scan Details",
      "",
    ]

    for (const scan of report.scans) {
      lines.push(`### ${scan.tool} (${scan.type})`)
      lines.push(`- Duration: ${scan.duration}ms`)
      lines.push(`- Findings: ${scan.findings.length}`)
      lines.push("")

      if (scan.findings.length > 0) {
        lines.push("| Severity | Title | File | Line |")
        lines.push("|----------|-------|------|------|")
        for (const f of scan.findings) {
          lines.push(
            `| ${f.severity} | ${f.title} | ${f.file ?? "N/A"} | ${f.line ?? "N/A"} |`,
          )
        }
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  export function toHTML(report: SecurityReport): string {
    const findings = report.scans.flatMap((s) => s.findings)
    const rows = findings
      .map(
        (f) =>
          `<tr><td>${f.severity}</td><td>${f.title}</td><td>${f.file ?? ""}</td><td>${f.line ?? ""}</td></tr>`,
      )
      .join("\n")

    return `<!DOCTYPE html>
<html>
<head><title>Security Report</title></head>
<body>
<h1>Security Report</h1>
<p>Status: ${report.passed ? "PASSED" : "FAILED"}</p>
<h2>Summary</h2>
<ul>
  <li>Critical: ${report.summary.critical}</li>
  <li>High: ${report.summary.high}</li>
  <li>Medium: ${report.summary.medium}</li>
  <li>Low: ${report.summary.low}</li>
</ul>
<h2>Findings</h2>
<table>
<tr><th>Severity</th><th>Title</th><th>File</th><th>Line</th></tr>
${rows}
</table>
</body>
</html>`
  }

  export function toJSON(report: SecurityReport): string {
    return JSON.stringify(report, null, 2)
  }

  export function filterBySeverity(
    report: SecurityReport,
    minSeverity: SecurityFinding["severity"],
  ): SecurityFinding[] {
    const order = ["info", "low", "medium", "high", "critical"]
    const minIdx = order.indexOf(minSeverity)
    return report.scans
      .flatMap((s) => s.findings)
      .filter((f) => order.indexOf(f.severity) >= minIdx)
  }
}
