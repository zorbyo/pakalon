import { Log } from "../util/log"

const log = Log.create({ service: "security:sast" })
const timeout = 300000

export interface SASTFinding {
  severity: "high" | "medium" | "low"
  rule: string
  file: string
  line: number
  message: string
  cwe?: string
}

export interface SASTResult {
  tool: string
  findings: SASTFinding[]
  summary: {
    high: number
    medium: number
    low: number
  }
  raw?: string
}

export namespace SASTTools {
  export function runSemgrep(projectPath: string, target?: string): SASTResult {
    const tgt = target ?? projectPath
    const out = Bun.spawnSync({
      cmd: ["semgrep", "--config=auto", "--json", "--quiet", tgt],
      cwd: projectPath,
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = semgrep(raw)
    const summary = summarizeFindings(findings)
    log.info("semgrep finished", { findings: findings.length, target: tgt })
    return { tool: "semgrep", findings, summary, raw }
  }

  export function runBandit(projectPath: string): SASTResult {
    const out = Bun.spawnSync({
      cmd: ["bandit", "-r", projectPath, "-f", "json", "-q"],
      cwd: projectPath,
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = bandit(raw)
    const summary = summarizeFindings(findings)
    log.info("bandit finished", { findings: findings.length })
    return { tool: "bandit", findings, summary, raw }
  }

  export function runGitleaks(projectPath: string): SASTResult {
    const out = Bun.spawnSync({
      cmd: ["gitleaks", "detect", "--source", projectPath, "--report-format", "json"],
      cwd: projectPath,
      timeout,
    })
    const raw = text(out.stdout, out.stderr)
    const findings = gitleaks(raw)
    const summary = summarizeFindings(findings)
    log.info("gitleaks finished", { findings: findings.length })
    return { tool: "gitleaks", findings, summary, raw }
  }

  export function summarizeFindings(findings: SASTFinding[]): SASTResult["summary"] {
    return findings.reduce(
      (acc, item) => {
        acc[item.severity] += 1
        return acc
      },
      { high: 0, medium: 0, low: 0 },
    )
  }

  export function formatResults(results: SASTResult[]): string {
    if (results.length === 0) return "# SAST Results\n\nNo scans executed.\n"
    const rows = results
      .map((item) => `| ${item.tool} | ${item.summary.high} | ${item.summary.medium} | ${item.summary.low} | ${item.findings.length} |`)
      .join("\n")
    const detail = results
      .map((item) => {
        if (item.findings.length === 0) return `## ${item.tool}\n\nNo findings.\n`
        const lines = item.findings
          .map((f) => `- **${f.severity.toUpperCase()}** ${f.rule} at \`${f.file}:${f.line}\` — ${f.message}${f.cwe ? ` (CWE: ${f.cwe})` : ""}`)
          .join("\n")
        return `## ${item.tool}\n\n${lines}\n`
      })
      .join("\n")
    return `# SAST Results\n\n| Tool | High | Medium | Low | Total |\n|---|---:|---:|---:|---:|\n${rows}\n\n${detail}`
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

function num(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return input
  if (typeof input !== "string") return 0
  const value = Number(input)
  if (!Number.isFinite(value)) return 0
  return value
}

function sev(input: unknown): SASTFinding["severity"] {
  const value = str(input).toLowerCase()
  if (value === "critical" || value === "error" || value === "high") return "high"
  if (value === "warning" || value === "medium") return "medium"
  return "low"
}

function semgrep(raw: string): SASTFinding[] {
  const data = record(json(raw))
  if (!data) return []
  return list(data.results).flatMap((item) => {
    const row = record(item)
    if (!row) return []
    const extra = record(row.extra)
    const start = record(row.start)
    const file = str(start?.file || row.path)
    const line = num(start?.line)
    const message = str(extra?.message || extra?.description)
    const cwe = str(extra?.metadata && record(extra.metadata)?.cwe)
    return [
      {
        severity: sev(extra?.severity),
        rule: str(row.check_id),
        file,
        line,
        message,
        cwe: cwe || undefined,
      },
    ]
  })
}

function bandit(raw: string): SASTFinding[] {
  const data = record(json(raw))
  if (!data) return []
  return list(data.results).flatMap((item) => {
    const row = record(item)
    if (!row) return []
    return [
      {
        severity: sev(row.issue_severity || row.severity),
        rule: str(row.test_id || row.test_name),
        file: str(row.filename),
        line: num(row.line_number),
        message: str(row.issue_text || row.more_info),
      },
    ]
  })
}

function gitleaks(raw: string): SASTFinding[] {
  const data = json(raw)
  const rows = list(data)
  if (rows.length === 0) return []
  return rows.flatMap((item) => {
    const row = record(item)
    if (!row) return []
    return [
      {
        severity: "high",
        rule: str(row.RuleID || row.Description),
        file: str(row.File),
        line: num(row.StartLine),
        message: str(row.Description || row.Match),
      },
    ]
  })
}
