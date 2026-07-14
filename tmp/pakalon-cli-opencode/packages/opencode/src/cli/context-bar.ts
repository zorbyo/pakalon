export namespace ContextBar {
  const size = 24

  function pct(used: number, total: number) {
    if (total <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((used / total) * 100)))
  }

  function bar(used: number, total: number) {
    if (total <= 0) return "░".repeat(size)
    const fill = Math.max(0, Math.min(size, Math.round((used / total) * size)))
    return "█".repeat(fill) + "░".repeat(size - fill)
  }

  export function formatContextBar(usage: { used: number; total: number; model: string }) {
    const p = pct(usage.used, usage.total)
    const b = bar(usage.used, usage.total)
    return `${usage.model} ${p}% [${b}] ${usage.used}/${usage.total}`
  }

  export function formatBudgetDisplay(budget: {
    total: number
    allocated: Record<string, number>
    used: Record<string, number>
  }) {
    const keys = Array.from(new Set([...Object.keys(budget.allocated), ...Object.keys(budget.used)])).sort()
    if (!keys.length) return `Budget: 0% (0/${budget.total})`

    const rows = keys.map((key) => {
      const alloc = budget.allocated[key] ?? 0
      const used = budget.used[key] ?? 0
      const left = Math.max(0, alloc - used)
      const p = pct(used, alloc)
      return `${key}: ${p}% (${used}/${alloc}) left:${left}`
    })

    const sum = keys.reduce((n, key) => n + (budget.used[key] ?? 0), 0)
    const top = `Budget: ${pct(sum, budget.total)}% (${sum}/${budget.total})`
    return [top, ...rows].join("\n")
  }

  export function formatWarning(remaining: number, total: number) {
    if (total <= 0) return ""
    const used = Math.max(0, total - remaining)
    const p = pct(used, total)
    if (p < 80) return ""
    if (p < 90) return `⚠ Context running low: ${remaining}/${total} tokens left (${100 - p}% remaining)`
    return `⚠ Context critical: ${remaining}/${total} tokens left (${100 - p}% remaining)`
  }
}
