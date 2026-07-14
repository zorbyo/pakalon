import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { aggregateSessionStats } from "./stats"
import { Session } from "../../session"

type UsagePeriod = "today" | "week" | "month" | "all"

interface UsageArgs {
  period: UsagePeriod
  byModel?: boolean
  bySession?: boolean
  maxSessions?: number
  json?: boolean
}

interface SessionUsage {
  sessionID: string
  title: string
  updated: number
  requests: number
  tokens: number
  cost: number
}

function periodToStart(period: UsagePeriod): number | undefined {
  const day = 24 * 60 * 60 * 1000
  if (period === "all") return undefined
  if (period === "today") {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now.getTime()
  }
  if (period === "week") return Date.now() - 7 * day
  return Date.now() - 30 * day
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-US")
}

async function getSessionBreakdown(start: number | undefined, maxSessions: number): Promise<SessionUsage[]> {
  const sessions = [...Session.list({ roots: true, start, limit: maxSessions })]
  const result: SessionUsage[] = []

  for (const session of sessions) {
    const messages = await Session.messages({ sessionID: session.id })
    let requests = 0
    let tokens = 0
    let cost = 0

    for (const message of messages) {
      if (message.info.role !== "assistant") continue
      requests += 1
      cost += message.info.cost || 0
      tokens +=
        (message.info.tokens?.input || 0) +
        (message.info.tokens?.output || 0) +
        (message.info.tokens?.reasoning || 0) +
        (message.info.tokens?.cache?.read || 0) +
        (message.info.tokens?.cache?.write || 0)
    }

    result.push({
      sessionID: session.id,
      title: session.title,
      updated: session.time.updated,
      requests,
      tokens,
      cost,
    })
  }

  return result.sort((a, b) => b.updated - a.updated)
}

export const UsageCommand = cmd({
  command: "usage",
  describe: "display API usage statistics",
  builder: (yargs: Argv) =>
    yargs
      .option("period", {
        alias: "p",
        type: "string",
        choices: ["today", "week", "month", "all"] as const,
        default: "all",
        describe: "Time period for usage stats",
      })
      .option("by-model", {
        alias: "m",
        type: "boolean",
        default: false,
        describe: "Break down by model",
      })
      .option("by-session", {
        alias: "s",
        type: "boolean",
        default: false,
        describe: "Break down by session",
      })
      .option("max-sessions", {
        type: "number",
        default: 20,
        describe: "Maximum number of sessions for --by-session breakdown",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: UsageArgs = {
      period: (rawArgs.period as UsagePeriod) ?? "all",
      byModel: Boolean(rawArgs.byModel),
      bySession: Boolean(rawArgs.bySession),
      maxSessions: typeof rawArgs.maxSessions === "number" ? rawArgs.maxSessions : 20,
      json: Boolean(rawArgs.json),
    }

    await bootstrap(process.cwd(), async () => {
      const start = periodToStart(args.period)
      const days =
        args.period === "today" ? 0
        : args.period === "week" ? 7
        : args.period === "month" ? 30
        : undefined

      const stats = await aggregateSessionStats(days)
      const totalRequests = Object.values(stats.modelUsage).reduce((sum, usage) => sum + usage.messages, 0)
      const totalTokens =
        stats.totalTokens.input +
        stats.totalTokens.output +
        stats.totalTokens.reasoning +
        stats.totalTokens.cache.read +
        stats.totalTokens.cache.write

      const modelBreakdown = Object.entries(stats.modelUsage)
        .sort(([, a], [, b]) => b.messages - a.messages)
        .map(([model, usage]) => ({
          model,
          requests: usage.messages,
          tokens: usage.tokens.input + usage.tokens.output + usage.tokens.cache.read + usage.tokens.cache.write,
          cost: usage.cost,
        }))

      const sessionBreakdown =
        args.bySession ? await getSessionBreakdown(start, Math.max(1, args.maxSessions || 20)) : undefined

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              period: args.period,
              start,
              summary: {
                sessions: stats.totalSessions,
                requests: totalRequests,
                tokens: {
                  input: stats.totalTokens.input,
                  output: stats.totalTokens.output,
                  reasoning: stats.totalTokens.reasoning,
                  cacheRead: stats.totalTokens.cache.read,
                  cacheWrite: stats.totalTokens.cache.write,
                  total: totalTokens,
                },
                cost: stats.totalCost,
              },
              ...(args.byModel ? { byModel: modelBreakdown } : {}),
              ...(args.bySession ? { bySession: sessionBreakdown ?? [] } : {}),
            },
            null,
            2,
          ),
        )
        return
      }

      UI.println(UI.Style.TEXT_HIGHLIGHT + "API Usage Statistics" + UI.Style.TEXT_NORMAL)
      UI.empty()
      UI.println(`Period: ${args.period}`)
      UI.println(`Sessions: ${formatNumber(stats.totalSessions)}`)
      UI.println(`Requests: ${formatNumber(totalRequests)}`)
      UI.println(`Input Tokens:  ${formatNumber(stats.totalTokens.input)}`)
      UI.println(`Output Tokens: ${formatNumber(stats.totalTokens.output + stats.totalTokens.reasoning)}`)
      UI.println(`Cache Tokens:  ${formatNumber(stats.totalTokens.cache.read + stats.totalTokens.cache.write)}`)
      UI.println(`Total Tokens:  ${formatNumber(totalTokens)}`)
      UI.println(`Total Cost:    $${stats.totalCost.toFixed(4)}`)

      if (args.byModel) {
        UI.empty()
        UI.println(UI.Style.TEXT_INFO + "By model:" + UI.Style.TEXT_NORMAL)
        if (modelBreakdown.length === 0) {
          UI.println("  (No model usage found)")
        } else {
          for (const model of modelBreakdown) {
            UI.println(`  ${model.model}`)
            UI.println(`    Requests: ${formatNumber(model.requests)}`)
            UI.println(`    Tokens:   ${formatNumber(model.tokens)}`)
            UI.println(`    Cost:     $${model.cost.toFixed(4)}`)
          }
        }
      }

      if (args.bySession) {
        UI.empty()
        UI.println(UI.Style.TEXT_INFO + "By session:" + UI.Style.TEXT_NORMAL)
        if (!sessionBreakdown || sessionBreakdown.length === 0) {
          UI.println("  (No session usage found)")
        } else {
          for (const session of sessionBreakdown) {
            UI.println(`  ${session.sessionID} (${new Date(session.updated).toLocaleString()})`)
            UI.println(`    Title:    ${session.title}`)
            UI.println(`    Requests: ${formatNumber(session.requests)}`)
            UI.println(`    Tokens:   ${formatNumber(session.tokens)}`)
            UI.println(`    Cost:     $${session.cost.toFixed(4)}`)
          }
        }
      }
    })
  },
})
