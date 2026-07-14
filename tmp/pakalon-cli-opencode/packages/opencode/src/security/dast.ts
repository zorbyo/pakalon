import { Log } from "../util/log"

const log = Log.create({ service: "security:dast" })
const timeout = 300000

export interface DASTFinding {
  severity: "critical" | "high" | "medium" | "low"
  type: string
  url: string
  evidence: string
  remediation?: string
}

export interface DASTResult {
  tool: string
  target: string
  findings: DASTFinding[]
  summary: {
    critical: number
    high: number
    medium: number
    low: number
  }
  raw?: string
}

export namespace DASTTools {
  export function runZAP(targetUrl: string): DASTResult {
    const out = Bun.spawnSync({
      cmd: [
        "docker",
        "run",
        "--rm",
        "owasp/zap2docker-stable",
        "zap-baseline.py",
        "-t",
        targetUrl,
        "-J",
        "-",
      ],
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = zap(raw)
    const summary = summarizeFindings(findings)
    log.info("zap finished", { findings: findings.length, target: targetUrl })
    return { tool: "zap", target: targetUrl, findings, summary, raw }
  }

  export function runNikto(targetUrl: string): DASTResult {
    const out = Bun.spawnSync({
      cmd: ["nikto", "-h", targetUrl, "-Format", "json"],
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = nikto(raw, targetUrl)
    const summary = summarizeFindings(findings)
    log.info("nikto finished", { findings: findings.length, target: targetUrl })
    return { tool: "nikto", target: targetUrl, findings, summary, raw }
  }

  export function runSqlmap(targetUrl: string, params?: string[]): DASTResult {
    const extra = params ?? []
    const out = Bun.spawnSync({
      cmd: ["sqlmap", "-u", targetUrl, "--batch", "--json", ...extra],
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = sqlmap(raw, targetUrl)
    const summary = summarizeFindings(findings)
    log.info("sqlmap finished", { findings: findings.length, target: targetUrl })
    return { tool: "sqlmap", target: targetUrl, findings, summary, raw }
  }

  export function summarizeFindings(findings: DASTFinding[]): DASTResult["summary"] {
    return findings.reduce(
      (acc, item) => {
        acc[item.severity] += 1
        return acc
      },
      { critical: 0, high: 0, medium: 0, low: 0 },
    )
  }

  export function formatResults(results: DASTResult[]): string {
    if (results.length === 0) return "# DAST Results\n\nNo scans executed.\n"
    const rows = results
      .map(
        (item) =>
          `| ${item.tool} | ${item.target} | ${item.summary.critical} | ${item.summary.high} | ${item.summary.medium} | ${item.summary.low} | ${item.findings.length} |`,
      )
      .join("\n")
    const detail = results
      .map((item) => {
        if (item.findings.length === 0) return `## ${item.tool}\n\nNo findings.\n`
        const lines = item.findings
          .map(
            (f) =>
              `- **${f.severity.toUpperCase()}** ${f.type} on ${f.url} — ${f.evidence}${f.remediation ? ` (Remediation: ${f.remediation})` : ""}`,
          )
          .join("\n")
        return `## ${item.tool}\n\n${lines}\n`
      })
      .join("\n")
    return `# DAST Results\n\n| Tool | Target | Critical | High | Medium | Low | Total |\n|---|---|---:|---:|---:|---:|---:|\n${rows}\n\n${detail}`
  }
}

function text(stdout: string | Uint8Array, stderr: string | Uint8Array): string {
  const out = typeof stdout === "string" ? stdout : new TextDecoder().decode(stdout)
  const err = typeof stderr === "string" ? stderr : new TextDecoder().decode(stderr)
  if (!out && !err) return ""
  if (!err) return out
  if (!out) return err
  return `${out}\n${err}`
}

function json(raw: string): unknown {
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function record(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

function list(input: unknown): unknown[] {
  if (!Array.isArray(input)) return []
  return input
}

function str(input: unknown): string {
  if (typeof input !== "string") return ""
  return input
}

function sev(input: unknown): DASTFinding["severity"] {
  const value = str(input).toLowerCase()
  if (value.includes("critical")) return "critical"
  if (value.includes("high")) return "high"
  if (value.includes("medium") || value.includes("warn")) return "medium"
  return "low"
}

function zap(raw: string): DASTFinding[] {
  const data = record(json(raw))
  if (!data) return []
  return list(data.site).flatMap((site) => {
    const node = record(site)
    if (!node) return []
    return list(node.alerts).flatMap((item) => {
      const row = record(item)
      if (!row) return []
      return [
        {
          severity: sev(row.riskdesc),
          type: str(row.name || row.alert),
          url: str(row.url),
          evidence: str(row.evidence || row.desc),
          remediation: str(row.solution) || undefined,
        },
      ]
    })
  })
}

function nikto(raw: string, target: string): DASTFinding[] {
  const data = json(raw)
  if (!data) return []
  const arr = Array.isArray(data) ? data : [data]
  return arr.flatMap<DASTFinding>((item) => {
    const row = record(item)
    if (!row) return []
    const vulns = list(row.vulnerabilities || row.items || row.findings)
    if (vulns.length === 0) {
      const msg = str(row.msg || row.description)
      if (!msg) return []
      return [{ severity: "low", type: "nikto", url: target, evidence: msg }]
    }
    return vulns.flatMap((v) => {
      const node = record(v)
      if (!node) return []
      return [
        {
          severity: sev(node.severity || node.risk),
          type: str(node.id || node.osvdb || node.name || "nikto"),
          url: str(node.url) || target,
          evidence: str(node.msg || node.description || node.method),
          remediation: str(node.remediation || node.solution) || undefined,
        },
      ]
    })
  })
}

function sqlmap(raw: string, target: string): DASTFinding[] {
  const data = json(raw)
  if (!data) return []
  const rows = list(data)
  if (rows.length === 0) {
    const one = record(data)
    if (!one) return []
    const msgs = list(one.messages || one.logs)
    return msgs.flatMap((m) => {
      const msg = typeof m === "string" ? m : str(record(m)?.message)
      if (!msg) return []
      if (!msg.toLowerCase().includes("inject")) return []
      return [{ severity: "high", type: "sqlmap", url: target, evidence: msg }]
    })
  }
  return rows.flatMap((item) => {
    const row = record(item)
    if (!row) return []
    const msg = str(row.message || row.title || row.data)
    if (!msg) return []
    const level = msg.toLowerCase().includes("critical") ? "critical" : msg.toLowerCase().includes("inject") ? "high" : "medium"
    return [
      {
        severity: level,
        type: str(row.type || row.level || "sqlmap"),
        url: str(row.url) || target,
        evidence: msg,
        remediation: str(row.remediation || row.solution) || undefined,
      },
    ]
  })
}
