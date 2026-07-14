import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { aggregateSessionStats } from "./stats"
import { Filesystem } from "../../util/filesystem"

interface InsightsArgs {
  days?: number
  all?: boolean
  output?: string
  json?: boolean
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US")
}

function toMarkdown(input: {
  generatedAt: string
  window: string
  sessions: number
  requests: number
  totalTokens: number
  totalCost: number
  avgCostPerDay: number
  avgTokensPerSession: number
  topModels: Array<{ model: string; requests: number; tokens: number; cost: number }>
  topTools: Array<{ tool: string; count: number }>
}) {
  const lines: string[] = []
  lines.push("# pakalon insights")
  lines.push("")
  lines.push(`Generated: ${input.generatedAt}`)
  lines.push(`Window: ${input.window}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Sessions: ${formatNumber(input.sessions)}`)
  lines.push(`- Requests: ${formatNumber(input.requests)}`)
  lines.push(`- Tokens: ${formatNumber(input.totalTokens)}`)
  lines.push(`- Cost: $${input.totalCost.toFixed(4)}`)
  lines.push(`- Avg cost/day: $${input.avgCostPerDay.toFixed(4)}`)
  lines.push(`- Avg tokens/session: ${formatNumber(Math.round(input.avgTokensPerSession))}`)
  lines.push("")
  lines.push("## Top models")
  lines.push("")

  if (input.topModels.length === 0) {
    lines.push("- (none)")
  } else {
    for (const model of input.topModels) {
      lines.push(
        `- ${model.model}: ${formatNumber(model.requests)} req · ${formatNumber(model.tokens)} tokens · $${model.cost.toFixed(4)}`,
      )
    }
  }

  lines.push("")
  lines.push("## Top tools")
  lines.push("")

  if (input.topTools.length === 0) {
    lines.push("- (none)")
  } else {
    for (const tool of input.topTools) {
      lines.push(`- ${tool.tool}: ${formatNumber(tool.count)}`)
    }
  }

  return lines.join("\n") + "\n"
}

export const InsightsCommand = cmd({
  command: "insights",
  describe: "generate a usage insights report from local session history",
  builder: (yargs) =>
    yargs
      .option("days", {
        type: "number",
        default: 30,
        describe: "Lookback window in days (ignored when --all is provided)",
      })
      .option("all", {
        type: "boolean",
        default: false,
        describe: "Use all-time history",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "Write markdown report to file",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: InsightsArgs = {
      days: typeof rawArgs.days === "number" ? rawArgs.days : undefined,
      all: Boolean(rawArgs.all),
      output: typeof rawArgs.output === "string" ? rawArgs.output : undefined,
      json: Boolean(rawArgs.json),
    }

    await bootstrap(process.cwd(), async () => {
      const days = args.all ? undefined : Math.max(0, Math.floor(args.days ?? 30))
      const stats = await aggregateSessionStats(days)

      const totalTokens =
        stats.totalTokens.input +
        stats.totalTokens.output +
        stats.totalTokens.reasoning +
        stats.totalTokens.cache.read +
        stats.totalTokens.cache.write

      const requests = Object.values(stats.modelUsage).reduce((sum, item) => sum + item.messages, 0)

      const topModels = Object.entries(stats.modelUsage)
        .map(([model, usage]) => ({
          model,
          requests: usage.messages,
          tokens: usage.tokens.input + usage.tokens.output + usage.tokens.cache.read + usage.tokens.cache.write,
          cost: usage.cost,
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10)

      const topTools = Object.entries(stats.toolUsage)
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      const report = {
        generatedAt: new Date().toISOString(),
        window: days === undefined ? "all-time" : days === 0 ? "today" : `last-${days}-days`,
        sessions: stats.totalSessions,
        requests,
        totalTokens,
        totalCost: stats.totalCost,
        avgCostPerDay: stats.costPerDay,
        avgTokensPerSession: stats.tokensPerSession,
        topModels,
        topTools,
      }

      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      const markdown = toMarkdown(report)

      if (args.output) {
        const filePath = path.resolve(process.cwd(), args.output)
        await Filesystem.write(filePath, markdown)
        UI.println(UI.Style.TEXT_SUCCESS + `✓ Insights report written to ${filePath}` + UI.Style.TEXT_NORMAL)
        return
      }

      UI.println(markdown)
    })
  },
})
