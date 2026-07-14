import { Log } from "../util/log"
import type { SecurityFinding } from "./orchestrator"

const log = Log.create({ service: "security:parser" })

export namespace SecurityParser {
  export function parseSemgrepJSON(json: string): SecurityFinding[] {
    try {
      const data = JSON.parse(json)
      const results = data.results ?? []
      return results.map((r: any) => ({
        id: r.check_id ?? `semgrep-${Math.random().toString(36).slice(2)}`,
        severity: mapSeverity(r.extra?.severity),
        title: r.check_id ?? "Unknown",
        description: r.extra?.message ?? "",
        file: r.path,
        line: r.start?.line,
        cwe: extractCWE(r.extra?.metadata),
        remediation: r.extra?.fix ?? undefined,
      }))
    } catch {
      log.warn("failed to parse semgrep JSON")
      return []
    }
  }

  export function parseGitleaksJSON(json: string): SecurityFinding[] {
    try {
      const data = JSON.parse(json)
      const results = Array.isArray(data) ? data : []
      return results.map((r: any) => ({
        id: r.RuleID ?? `gitleaks-${Math.random().toString(36).slice(2)}`,
        severity: "high" as const,
        title: `Secret detected: ${r.Description ?? r.RuleID}`,
        description: `Potential secret found in ${r.File}`,
        file: r.File,
        line: r.StartLine,
        remediation: "Remove the secret and rotate credentials",
      }))
    } catch {
      log.warn("failed to parse gitleaks JSON")
      return []
    }
  }

  export function parseZapJSON(json: string): SecurityFinding[] {
    try {
      const data = JSON.parse(json)
      const sites = data.site ?? []
      const findings: SecurityFinding[] = []
      for (const site of sites) {
        for (const alert of site.alerts ?? []) {
          findings.push({
            id: alert.pluginId ?? `zap-${Math.random().toString(36).slice(2)}`,
            severity: mapZapRisk(alert.riskdesc),
            title: alert.name ?? "Unknown",
            description: alert.desc ?? "",
            cwe: alert.cweid,
            remediation: alert.solution,
          })
        }
      }
      return findings
    } catch {
      log.warn("failed to parse ZAP JSON")
      return []
    }
  }

  export function parseGenericJSON(json: string): SecurityFinding[] {
    try {
      const data = JSON.parse(json)
      if (Array.isArray(data)) {
        return data.map((item: any) => ({
          id: item.id ?? `finding-${Math.random().toString(36).slice(2)}`,
          severity: mapSeverity(item.severity),
          title: item.title ?? item.name ?? "Unknown",
          description: item.description ?? item.message ?? "",
          file: item.file ?? item.path,
          line: item.line,
          cwe: item.cwe,
          remediation: item.remediation ?? item.fix,
        }))
      }
      return []
    } catch {
      return []
    }
  }

  function mapSeverity(s: string): SecurityFinding["severity"] {
    const sev = (s ?? "").toLowerCase()
    if (sev === "error" || sev === "critical") return "critical"
    if (sev === "warning" || sev === "high") return "high"
    if (sev === "medium") return "medium"
    if (sev === "low") return "low"
    return "info"
  }

  function mapZapRisk(risk: string): SecurityFinding["severity"] {
    const r = (risk ?? "").toLowerCase()
    if (r.includes("high")) return "high"
    if (r.includes("medium")) return "medium"
    if (r.includes("low")) return "low"
    return "info"
  }

  function extractCWE(metadata: any): string | undefined {
    if (!metadata) return undefined
    if (metadata.cwe) return metadata.cwe
    if (metadata.cwe_id) return metadata.cwe_id
    return undefined
  }
}
