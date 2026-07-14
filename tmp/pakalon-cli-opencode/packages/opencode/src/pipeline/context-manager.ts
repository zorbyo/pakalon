import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Pakalon } from "../pakalon"

const log = Log.create({ service: "pipeline:context" })

export interface TokenBudget {
  total: number
  phases: Record<string, PhaseAllocation>
}

export interface PhaseAllocation {
  allocated: number
  used: number
  remaining: number
  buffer: number
}

const DEFAULT_TOTAL = 200_000
const PHASE_WEIGHTS: Record<number, number> = {
  1: 0.15,
  2: 0.10,
  3: 0.40,
  4: 0.15,
  5: 0.10,
  6: 0.10,
}
const BUFFER_PCT = 0.1

export namespace ContextManager {
  export function create(total?: number): TokenBudget {
    const t = total ?? DEFAULT_TOTAL
    const phases: Record<string, PhaseAllocation> = {}
    for (let i = 1; i <= 6; i++) {
      const raw = Math.floor(t * PHASE_WEIGHTS[i])
      const buffer = Math.floor(raw * BUFFER_PCT)
      const allocated = raw - buffer
      phases[`phase-${i}`] = { allocated, used: 0, remaining: allocated, buffer }
    }
    return { total: t, phases }
  }

  export function allocateForProject(isNew: boolean, total?: number): TokenBudget {
    const t = total ?? DEFAULT_TOTAL
    const pct = isNew ? 0.65 : 0.35
    const projectTotal = Math.floor(t * pct)
    return create(projectTotal)
  }

  export async function save(projectPath: string, budget: TokenBudget): Promise<void> {
    const dir = Pakalon.agentsDir(projectPath)
    const p = `${dir}/context_management.md`
    const lines = [
      "# Context Management",
      "",
      `Total Budget: ${budget.total} tokens`,
      "",
      "## Phase Allocations",
      "",
    ]
    for (const [key, alloc] of Object.entries(budget.phases)) {
      lines.push(`### ${key}`)
      lines.push(`- Allocated: ${alloc.allocated}`)
      lines.push(`- Used: ${alloc.used}`)
      lines.push(`- Remaining: ${alloc.remaining}`)
      lines.push(`- Buffer: ${alloc.buffer}`)
      lines.push("")
    }
    await Filesystem.write(p, lines.join("\n"))
    log.info("saved context budget", { path: p })
  }

  export function recordUsage(budget: TokenBudget, phase: string, tokens: number): TokenBudget {
    const alloc = budget.phases[phase]
    if (!alloc) return budget
    alloc.used += tokens
    alloc.remaining = Math.max(0, alloc.allocated - alloc.used)
    return { ...budget, phases: { ...budget.phases, [phase]: { ...alloc } } }
  }

  export function isNearLimit(budget: TokenBudget, phase: string, threshold = 0.8): boolean {
    const alloc = budget.phases[phase]
    if (!alloc) return false
    return alloc.used / alloc.allocated >= threshold
  }

  export function isExhausted(budget: TokenBudget, phase: string): boolean {
    const alloc = budget.phases[phase]
    if (!alloc) return false
    return alloc.remaining <= 0
  }

  export function getUsagePct(budget: TokenBudget, phase: string): number {
    const alloc = budget.phases[phase]
    if (!alloc || alloc.allocated <= 0) return 0
    return Math.round((alloc.used / alloc.allocated) * 100)
  }

  export function shouldCompress(budget: TokenBudget, phase: string): boolean {
    return isNearLimit(budget, phase, 0.8)
  }

  export function shouldHalt(budget: TokenBudget, phase: string): boolean {
    return isExhausted(budget, phase)
  }

  export function compress(budget: TokenBudget, phase: string): TokenBudget {
    const alloc = budget.phases[phase]
    if (!alloc) return budget
    const newAlloc = {
      ...alloc,
      used: Math.floor(alloc.used * 0.5),
      remaining: Math.floor(alloc.remaining + alloc.used * 0.5),
    }
    return { ...budget, phases: { ...budget.phases, [phase]: newAlloc } }
  }

  export function summary(budget: TokenBudget): string {
    const lines: string[] = []
    let totalUsed = 0
    let totalAlloc = 0
    for (const [key, alloc] of Object.entries(budget.phases)) {
      totalUsed += alloc.used
      totalAlloc += alloc.allocated
      const pct = alloc.allocated > 0 ? Math.round((alloc.used / alloc.allocated) * 100) : 0
      lines.push(`${key}: ${pct}% used (${alloc.used}/${alloc.allocated})`)
    }
    const overallPct = totalAlloc > 0 ? Math.round((totalUsed / totalAlloc) * 100) : 0
    lines.unshift(`Overall: ${overallPct}% (${totalUsed}/${totalAlloc})`)
    return lines.join("\n")
  }
}
