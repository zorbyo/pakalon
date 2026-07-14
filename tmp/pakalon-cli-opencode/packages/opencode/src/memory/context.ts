import { Log } from "../util/log"
import { Mem0, type MemoryEntry } from "./mem0"

const log = Log.create({ service: "memory:context" })

export namespace Context {
  export function passBetweenPhases(fromPhase: number, toPhase: number): string {
    const context = Mem0.crossPhaseContext(fromPhase, toPhase)
    log.info("passing context between phases", { from: fromPhase, to: toPhase })
    return context
  }

  export function summarize(phase: number): string {
    const entries = Mem0.getByPhase(phase)
    if (entries.length === 0) return `No context stored for Phase ${phase}`

    const lines = [`# Phase ${phase} Context Summary`, ""]
    for (const entry of entries) {
      lines.push(`- **${entry.key}**: ${entry.value.slice(0, 100)}...`)
    }
    return lines.join("\n")
  }

  export function relevantEntries(query: string, limit = 5): MemoryEntry[] {
    const results = Mem0.search(query)
    return results.slice(0, limit)
  }

  export function buildContextString(phase: number, sessionId: string): string {
    const phaseEntries = Mem0.getByPhase(phase)
    const sessionEntries = Mem0.getBySession(sessionId)
    const all = [...phaseEntries, ...sessionEntries]

    const seen = new Set<string>()
    const unique = all.filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })

    if (unique.length === 0) return ""
    return unique.map((e) => `[${e.key}]: ${e.value}`).join("\n")
  }
}
