import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { aggregateSessionStats } from "./stats"
import * as Backend from "../../backend"
import { readRateLimitMockState } from "./rate-limit-state"

interface GoodClaudeArgs {
  days?: number
  json?: boolean
}

type SignalStatus = "good" | "warn" | "bad"

interface QualitySignal {
  key: string
  status: SignalStatus
  message: string
  penalty: number
}

interface GoodClaudeReport {
  generatedAt: string
  window: {
    days: number
  }
  summary: {
    sessions: number
    requests: number
    messages: number
    totalTokens: number
    averageMessagesPerSession: number
    averageTokensPerSession: number
    medianTokensPerSession: number
    uniqueModels: number
    uniqueTools: number
    topModel?: {
      id: string
      requests: number
      share: number
    }
  }
  quality: {
    score: number
    grade: "excellent" | "good" | "fair" | "poor"
    signals: QualitySignal[]
    recommendations: string[]
  }
  backend: {
    enabled: boolean
    startupAllowed?: boolean
    reason?: string
  }
  mockLimits: {
    enabled: boolean
    profile: string
    reason?: string
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function gradeFromScore(score: number): GoodClaudeReport["quality"]["grade"] {
  if (score >= 90) return "excellent"
  if (score >= 75) return "good"
  if (score >= 55) return "fair"
  return "poor"
}

function iconForSignal(status: SignalStatus): string {
  if (status === "good") return "✓"
  if (status === "warn") return "!"
  return "✗"
}

function statusColor(status: SignalStatus): string {
  if (status === "good") return UI.Style.TEXT_SUCCESS
  if (status === "warn") return UI.Style.TEXT_WARNING
  return UI.Style.TEXT_DANGER
}

export const GoodClaudeCommand = cmd({
  command: "good-claude",
  describe: "run quality diagnostics across recent sessions (compat command)",
  builder: (yargs) =>
    yargs
      .option("days", {
        type: "number",
        default: 7,
        describe: "Analyze the last N days of session history",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: GoodClaudeArgs = {
      days: typeof rawArgs.days === "number" && Number.isFinite(rawArgs.days) ? Math.max(0, rawArgs.days) : 7,
      json: Boolean(rawArgs.json),
    }

    const report = await bootstrap(process.cwd(), async () => {
      const stats = await aggregateSessionStats(args.days)
      const mock = await readRateLimitMockState()

      const backendEnabled = Backend.isBackendEnabled()
      const startup = backendEnabled ? await Backend.UsageBackend.checkStartup().catch(() => undefined) : undefined

      const totalTokens =
        stats.totalTokens.input +
        stats.totalTokens.output +
        stats.totalTokens.reasoning +
        stats.totalTokens.cache.read +
        stats.totalTokens.cache.write

      const requests = Object.values(stats.modelUsage).reduce((sum, model) => sum + model.messages, 0)
      const uniqueModels = Object.keys(stats.modelUsage).length
      const uniqueTools = Object.keys(stats.toolUsage).length

      const averageMessagesPerSession = stats.totalSessions > 0 ? stats.totalMessages / stats.totalSessions : 0
      const averageTokensPerSession = stats.totalSessions > 0 ? totalTokens / stats.totalSessions : 0

      const topModel = (() => {
        const entries = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
        if (entries.length === 0 || requests === 0) return undefined
        const [id, info] = entries[0]
        return {
          id,
          requests: info.messages,
          share: info.messages / requests,
        }
      })()

      const signals: QualitySignal[] = []

      if (stats.totalSessions === 0) {
        signals.push({
          key: "session-history",
          status: "bad",
          message: "No recent sessions found in the selected window.",
          penalty: 45,
        })
      } else if (stats.totalSessions < 3) {
        signals.push({
          key: "session-history",
          status: "warn",
          message: "Very little session history; diagnostics confidence is limited.",
          penalty: 15,
        })
      } else {
        signals.push({
          key: "session-history",
          status: "good",
          message: "Enough session history to evaluate quality trends.",
          penalty: 0,
        })
      }

      if (stats.totalSessions > 0 && averageMessagesPerSession < 2) {
        signals.push({
          key: "conversation-depth",
          status: "warn",
          message: "Average messages per session is low; prompts may be too short-lived.",
          penalty: 10,
        })
      } else {
        signals.push({
          key: "conversation-depth",
          status: "good",
          message: "Conversation depth looks healthy for iterative workflows.",
          penalty: 0,
        })
      }

      if (averageTokensPerSession > 200_000 || stats.medianTokensPerSession > 200_000) {
        signals.push({
          key: "context-size",
          status: "bad",
          message: "Session context is frequently very large; this can slow responses and raise cost.",
          penalty: 25,
        })
      } else if (averageTokensPerSession > 100_000 || stats.medianTokensPerSession > 100_000) {
        signals.push({
          key: "context-size",
          status: "warn",
          message: "Session context is trending large; consider compaction to keep latency stable.",
          penalty: 12,
        })
      } else {
        signals.push({
          key: "context-size",
          status: "good",
          message: "Token footprint per session is in a healthy range.",
          penalty: 0,
        })
      }

      if (requests >= 20 && topModel && topModel.share > 0.9) {
        signals.push({
          key: "model-diversity",
          status: "warn",
          message: `Single-model heavy usage (${(topModel.share * 100).toFixed(1)}% on ${topModel.id}).`,
          penalty: 10,
        })
      } else {
        signals.push({
          key: "model-diversity",
          status: "good",
          message: "Model usage distribution looks balanced for this window.",
          penalty: 0,
        })
      }

      if (requests >= 10 && uniqueTools === 0) {
        signals.push({
          key: "tool-coverage",
          status: "bad",
          message: "No tool usage detected despite active requests.",
          penalty: 20,
        })
      } else if (requests >= 10 && uniqueTools <= 1) {
        signals.push({
          key: "tool-coverage",
          status: "warn",
          message: "Tool usage is narrow; capability coverage may be limited.",
          penalty: 8,
        })
      } else {
        signals.push({
          key: "tool-coverage",
          status: "good",
          message: "Tool usage suggests healthy capability coverage.",
          penalty: 0,
        })
      }

      if (mock.enabled && mock.profile !== "off") {
        signals.push({
          key: "mock-limits",
          status: "bad",
          message: `Local mock rate limits are enabled (${mock.profile}).`,
          penalty: 30,
        })
      } else {
        signals.push({
          key: "mock-limits",
          status: "good",
          message: "Mock limits are disabled.",
          penalty: 0,
        })
      }

      if (backendEnabled && startup?.allowed === false) {
        signals.push({
          key: "backend-startup",
          status: "bad",
          message: `Backend startup is blocked${startup.reason ? `: ${startup.reason}` : "."}`,
          penalty: 22,
        })
      } else {
        signals.push({
          key: "backend-startup",
          status: "good",
          message: backendEnabled
            ? "Backend startup checks are currently passing."
            : "Backend integration is disabled in this environment.",
          penalty: 0,
        })
      }

      const totalPenalty = signals.reduce((sum, signal) => sum + signal.penalty, 0)
      const score = clamp(100 - totalPenalty, 0, 100)
      const grade = gradeFromScore(score)

      const recommendations: string[] = []

      if (stats.totalSessions === 0) {
        recommendations.push("Run a few real sessions, then re-run `pakalon good-claude --days 7`.")
      }
      if (mock.enabled && mock.profile !== "off") {
        recommendations.push("Disable local mock limits with `pakalon mock-limits off`.")
      }
      if (backendEnabled && startup?.allowed === false) {
        recommendations.push("Run `pakalon rate-limit-options` and use `pakalon extra-usage --open` if needed.")
      }
      if (averageTokensPerSession > 100_000 || stats.medianTokensPerSession > 100_000) {
        recommendations.push("Use `pakalon compact` periodically to keep context windows smaller.")
      }
      if (requests >= 10 && uniqueTools <= 1) {
        recommendations.push("Ask for explicit tool-assisted steps (search, edits, tests) to improve execution quality.")
      }
      if (recommendations.length === 0) {
        recommendations.push("Everything looks healthy. Keep this workflow and monitor with `pakalon insights`.")
      }

      const payload: GoodClaudeReport = {
        generatedAt: new Date().toISOString(),
        window: {
          days: args.days ?? 7,
        },
        summary: {
          sessions: stats.totalSessions,
          requests,
          messages: stats.totalMessages,
          totalTokens,
          averageMessagesPerSession,
          averageTokensPerSession,
          medianTokensPerSession: stats.medianTokensPerSession,
          uniqueModels,
          uniqueTools,
          topModel,
        },
        quality: {
          score,
          grade,
          signals,
          recommendations,
        },
        backend: {
          enabled: backendEnabled,
          startupAllowed: startup?.allowed,
          reason: startup?.reason,
        },
        mockLimits: {
          enabled: mock.enabled,
          profile: mock.profile,
          reason: mock.reason,
        },
      }

      return payload
    })

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Good Claude (Pakalon equivalent)" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(`Score: ${report.quality.score}/100 (${report.quality.grade})`)
    UI.println(
      `Window: last ${report.window.days} day(s) · sessions=${report.summary.sessions} · requests=${report.summary.requests}`,
    )
    UI.println(
      `Tokens/session avg=${Math.round(report.summary.averageTokensPerSession)} median=${Math.round(report.summary.medianTokensPerSession)}`,
    )
    if (report.summary.topModel) {
      UI.println(
        `Top model: ${report.summary.topModel.id} (${(report.summary.topModel.share * 100).toFixed(1)}% of requests)`,
      )
    }

    UI.empty()
    UI.println(UI.Style.TEXT_HIGHLIGHT + "Signals" + UI.Style.TEXT_NORMAL)
    for (const signal of report.quality.signals) {
      const color = statusColor(signal.status)
      UI.println(`${color}${iconForSignal(signal.status)}${UI.Style.TEXT_NORMAL} ${signal.key}: ${signal.message}`)
    }

    UI.empty()
    UI.println(UI.Style.TEXT_HIGHLIGHT + "Recommendations" + UI.Style.TEXT_NORMAL)
    for (const item of report.quality.recommendations) {
      UI.println(`- ${item}`)
    }
  },
})
