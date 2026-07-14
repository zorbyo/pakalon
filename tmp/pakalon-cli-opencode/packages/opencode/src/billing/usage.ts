import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"

const log = Log.create({ service: "billing:usage" })

export interface UsageRecord {
  id: string
  sessionId: string
  modelId: string
  providerId: string
  inputTokens: number
  outputTokens: number
  cost: number
  timestamp: number
}

export interface UsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  recordCount: number
  byModel: Record<string, { input: number; output: number; cost: number }>
  periodStart: number
  periodEnd: number
}

const usageFile = path.join(Global.Path.data, "usage.json")

export namespace Usage {
  const records: UsageRecord[] = []

  export function record(entry: Omit<UsageRecord, "id">): UsageRecord {
    const rec: UsageRecord = {
      ...entry,
      id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    records.push(rec)
    log.info("recorded usage", { model: rec.modelId, cost: rec.cost })
    return rec
  }

  export function list(sessionId?: string): UsageRecord[] {
    if (sessionId) return records.filter((r) => r.sessionId === sessionId)
    return [...records]
  }

  export function summary(periodStart?: number, periodEnd?: number): UsageSummary {
    const start = periodStart ?? 0
    const end = periodEnd ?? Date.now()
    const filtered = records.filter((r) => r.timestamp >= start && r.timestamp <= end)

    const byModel: Record<string, { input: number; output: number; cost: number }> = {}
    let totalInput = 0
    let totalOutput = 0
    let totalCost = 0

    for (const rec of filtered) {
      totalInput += rec.inputTokens
      totalOutput += rec.outputTokens
      totalCost += rec.cost

      if (!byModel[rec.modelId]) {
        byModel[rec.modelId] = { input: 0, output: 0, cost: 0 }
      }
      byModel[rec.modelId].input += rec.inputTokens
      byModel[rec.modelId].output += rec.outputTokens
      byModel[rec.modelId].cost += rec.cost
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCost,
      recordCount: filtered.length,
      byModel,
      periodStart: start,
      periodEnd: end,
    }
  }

  export async function save(): Promise<void> {
    await Filesystem.writeJson(usageFile, records)
  }

  export async function load(): Promise<void> {
    try {
      const data = await Filesystem.readJson<UsageRecord[]>(usageFile)
      records.length = 0
      records.push(...data)
      log.info("loaded usage records", { count: records.length })
    } catch {
      log.info("no existing usage records found")
    }
  }

  export function formatSummary(s: UsageSummary): string {
    const lines = [
      "## Usage Summary",
      "",
      `**Period:** ${new Date(s.periodStart).toLocaleDateString()} - ${new Date(s.periodEnd).toLocaleDateString()}`,
      `**Total Records:** ${s.recordCount}`,
      `**Total Input Tokens:** ${s.totalInputTokens.toLocaleString()}`,
      `**Total Output Tokens:** ${s.totalOutputTokens.toLocaleString()}`,
      `**Total Cost:** $${s.totalCost.toFixed(4)}`,
      "",
      "### By Model",
    ]
    for (const [model, data] of Object.entries(s.byModel)) {
      lines.push(`- **${model}**: ${data.input + data.output} tokens, $${data.cost.toFixed(4)}`)
    }
    return lines.join("\n")
  }
}
