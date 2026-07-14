import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { aggregateSessionStats } from "./stats"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import type { SessionID } from "../../session/schema"

interface CostArgs {
  session?: boolean
  today?: boolean
  detailed?: boolean
}

interface CostSummary {
  requests: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  modelUsage: Record<string, { requests: number; tokens: number; cost: number }>
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-US")
}

function startOfToday(): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.getTime()
}

function printDetailedModelBreakdown(summary: CostSummary) {
  const entries = Object.entries(summary.modelUsage).sort(([, a], [, b]) => b.cost - a.cost)
  UI.empty()
  UI.println(UI.Style.TEXT_INFO + "By model:" + UI.Style.TEXT_NORMAL)

  if (entries.length === 0) {
    UI.println("  (No model usage found)")
    return
  }

  for (const [model, usage] of entries) {
    UI.println(`  ${model}`)
    UI.println(`    Requests: ${formatNumber(usage.requests)}`)
    UI.println(`    Tokens:   ${formatNumber(usage.tokens)}`)
    UI.println(`    Cost:     $${usage.cost.toFixed(4)}`)
  }
}

async function summarizeSession(sessionID: SessionID): Promise<CostSummary> {
  const messages = await Session.messages({ sessionID })
  const summary: CostSummary = {
    requests: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    cost: 0,
    modelUsage: {},
  }

  for (const message of messages) {
    if (message.info.role !== "assistant") continue
    summary.requests += 1
    summary.cost += message.info.cost || 0

    const input = message.info.tokens?.input || 0
    const output = message.info.tokens?.output || 0
    const reasoning = message.info.tokens?.reasoning || 0
    const cacheRead = message.info.tokens?.cache?.read || 0
    const cacheWrite = message.info.tokens?.cache?.write || 0
    const total = input + output + reasoning + cacheRead + cacheWrite

    summary.tokens.input += input
    summary.tokens.output += output
    summary.tokens.reasoning += reasoning
    summary.tokens.cacheRead += cacheRead
    summary.tokens.cacheWrite += cacheWrite
    summary.tokens.total += total

    const model = `${message.info.providerID}/${message.info.modelID}`
    if (!summary.modelUsage[model]) {
      summary.modelUsage[model] = { requests: 0, tokens: 0, cost: 0 }
    }
    summary.modelUsage[model].requests += 1
    summary.modelUsage[model].tokens += total
    summary.modelUsage[model].cost += message.info.cost || 0
  }

  return summary
}

export const CostCommand = cmd({
  command: "cost",
  describe: "display token usage and cost information",
  builder: (yargs: Argv) =>
    yargs
      .option("session", {
        alias: "s",
        type: "boolean",
        default: false,
        describe: "Show cost for the latest session only",
      })
      .option("today", {
        alias: "t",
        type: "boolean",
        default: false,
        describe: "Show cost for today",
      })
      .option("detailed", {
        alias: "d",
        type: "boolean",
        default: false,
        describe: "Show model-by-model breakdown",
      }),
  handler: async (rawArgs) => {
    const args: CostArgs = {
      session: Boolean(rawArgs.session),
      today: Boolean(rawArgs.today),
      detailed: Boolean(rawArgs.detailed),
    }

    await bootstrap(process.cwd(), async () => {
      UI.println(UI.Style.TEXT_HIGHLIGHT + "Cost & Usage" + UI.Style.TEXT_NORMAL)
      UI.empty()

      if (args.session) {
        const latest = [...Session.list({ roots: true, limit: 1 })][0]
        if (!latest) {
          UI.println(UI.Style.TEXT_DIM + "No sessions found." + UI.Style.TEXT_NORMAL)
          return
        }

        const summary = await summarizeSession(latest.id)
        UI.println(`Session: ${latest.id}`)
        UI.println(`Title:   ${latest.title}`)
        UI.println(`Requests: ${formatNumber(summary.requests)}`)
        UI.println(`Input:    ${formatNumber(summary.tokens.input)}`)
        UI.println(`Output:   ${formatNumber(summary.tokens.output + summary.tokens.reasoning)}`)
        UI.println(`Cache:    ${formatNumber(summary.tokens.cacheRead + summary.tokens.cacheWrite)}`)
        UI.println(`Total:    ${formatNumber(summary.tokens.total)}`)
        UI.println(`Cost:     $${summary.cost.toFixed(4)}`)

        if (args.detailed) {
          printDetailedModelBreakdown(summary)
        }
        return
      }

      const days = args.today ? 0 : undefined
      const stats = await aggregateSessionStats(days)
      const totalRequests = Object.values(stats.modelUsage).reduce((sum, usage) => sum + usage.messages, 0)
      const totalTokens =
        stats.totalTokens.input +
        stats.totalTokens.output +
        stats.totalTokens.reasoning +
        stats.totalTokens.cache.read +
        stats.totalTokens.cache.write

      if (args.today) {
        UI.println(`Window: today (since ${new Date(startOfToday()).toLocaleString()})`)
      } else {
        UI.println("Window: all time")
      }
      UI.println(`Sessions: ${formatNumber(stats.totalSessions)}`)
      UI.println(`Requests: ${formatNumber(totalRequests)}`)
      UI.println(`Input:    ${formatNumber(stats.totalTokens.input)}`)
      UI.println(`Output:   ${formatNumber(stats.totalTokens.output + stats.totalTokens.reasoning)}`)
      UI.println(`Cache:    ${formatNumber(stats.totalTokens.cache.read + stats.totalTokens.cache.write)}`)
      UI.println(`Total:    ${formatNumber(totalTokens)}`)
      UI.println(`Cost:     $${stats.totalCost.toFixed(4)}`)

      if (args.detailed) {
        const detailed: CostSummary = {
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
          modelUsage: Object.fromEntries(
            Object.entries(stats.modelUsage).map(([model, usage]) => {
              const modelTokens =
                usage.tokens.input + usage.tokens.output + usage.tokens.cache.read + usage.tokens.cache.write
              return [
                model,
                {
                  requests: usage.messages,
                  tokens: modelTokens,
                  cost: usage.cost,
                },
              ]
            }),
          ),
        }
        printDetailedModelBreakdown(detailed)
      }
    })
  },
})
