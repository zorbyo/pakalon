import fs from "fs/promises"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { aggregateSessionStats } from "./stats"
import { Global } from "../../global"
import * as Backend from "../../backend"
import { readRateLimitMockState } from "./rate-limit-state"

interface PerfIssueArgs {
  days?: number
  output?: string
  json?: boolean
}

type SessionStats = Awaited<ReturnType<typeof aggregateSessionStats>>

interface PerfIssueReport {
  generatedAt: string
  runtime: {
    platform: string
    nodeVersion: string
    pid: number
    uptimeSeconds: number
    cwd: string
  }
  memory: ReturnType<typeof process.memoryUsage>
  stats: SessionStats
  backend: {
    enabled: boolean
    startupAllowed?: boolean
    reason?: string
    plan?: string
    creditsRemaining?: number
    creditsTotal?: number
  }
  mockLimits: {
    enabled: boolean
    profile: string
    reason?: string
    updatedAt?: string
  }
}

function buildMarkdown(report: PerfIssueReport): string {
  const totalTokens =
    report.stats.totalTokens.input +
    report.stats.totalTokens.output +
    report.stats.totalTokens.reasoning +
    report.stats.totalTokens.cache.read +
    report.stats.totalTokens.cache.write

  return [
    "# Pakalon Performance Issue Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Runtime",
    `- Platform: ${report.runtime.platform}`,
    `- Node/Bun Runtime: ${report.runtime.nodeVersion}`,
    `- PID: ${report.runtime.pid}`,
    `- Uptime (s): ${report.runtime.uptimeSeconds.toFixed(1)}`,
    `- CWD: ${report.runtime.cwd}`,
    "",
    "## Memory",
    `- RSS: ${report.memory.rss}`,
    `- Heap Total: ${report.memory.heapTotal}`,
    `- Heap Used: ${report.memory.heapUsed}`,
    `- External: ${report.memory.external}`,
    "",
    "## Session Stats",
    `- Sessions: ${report.stats.totalSessions}`,
    `- Messages: ${report.stats.totalMessages}`,
    `- Days Window: ${report.stats.days}`,
    `- Total Cost: ${report.stats.totalCost.toFixed(4)}`,
    `- Total Tokens: ${totalTokens}`,
    `- Avg Tokens/Session: ${report.stats.tokensPerSession.toFixed(1)}`,
    "",
    "## Backend",
    `- Enabled: ${report.backend.enabled ? "yes" : "no"}`,
    `- Startup Allowed: ${report.backend.startupAllowed === false ? "no" : "yes"}`,
    `- Reason: ${report.backend.reason ?? "n/a"}`,
    `- Plan: ${report.backend.plan ?? "n/a"}`,
    `- Credits: ${
      typeof report.backend.creditsRemaining === "number" && typeof report.backend.creditsTotal === "number"
        ? `${report.backend.creditsRemaining}/${report.backend.creditsTotal}`
        : "n/a"
    }`,
    "",
    "## Mock Limits",
    `- Enabled: ${report.mockLimits.enabled ? "yes" : "no"}`,
    `- Profile: ${report.mockLimits.profile}`,
    `- Reason: ${report.mockLimits.reason ?? "n/a"}`,
    `- Updated At: ${report.mockLimits.updatedAt ?? "n/a"}`,
    "",
  ].join("\n")
}

export const PerfIssueCommand = cmd({
  command: "perf-issue",
  describe: "generate a diagnostics report for performance troubleshooting",
  builder: (yargs) =>
    yargs
      .option("days", {
        type: "number",
        default: 7,
        describe: "Aggregate session stats for the last N days",
      })
      .option("output", {
        alias: "o",
        type: "string",
        describe: "Output markdown file path",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON summary",
      }),
  handler: async (rawArgs) => {
    const args: PerfIssueArgs = {
      days: typeof rawArgs.days === "number" && Number.isFinite(rawArgs.days) ? rawArgs.days : 7,
      output: typeof rawArgs.output === "string" ? rawArgs.output : undefined,
      json: Boolean(rawArgs.json),
    }

    const report = await bootstrap(process.cwd(), async () => {
      const stats = await aggregateSessionStats(args.days)
      const mock = await readRateLimitMockState()

      const backendEnabled = Backend.isBackendEnabled()
      const [startup, credits] = await Promise.all([
        backendEnabled ? Backend.UsageBackend.checkStartup().catch(() => undefined) : Promise.resolve(undefined),
        backendEnabled ? Backend.UsageBackend.getCreditsBalance().catch(() => undefined) : Promise.resolve(undefined),
      ])

      const payload: PerfIssueReport = {
        generatedAt: new Date().toISOString(),
        runtime: {
          platform: process.platform,
          nodeVersion: process.version,
          pid: process.pid,
          uptimeSeconds: process.uptime(),
          cwd: process.cwd(),
        },
        memory: process.memoryUsage(),
        stats,
        backend: {
          enabled: backendEnabled,
          startupAllowed: startup?.allowed,
          reason: startup?.reason,
          plan: credits?.plan,
          creditsRemaining: credits?.credits_remaining,
          creditsTotal: credits?.credits_total,
        },
        mockLimits: {
          enabled: mock.enabled,
          profile: mock.profile,
          reason: mock.reason,
          updatedAt: mock.updatedAt,
        },
      }

      return payload
    })

    const outputPath = (() => {
      if (args.output) return path.resolve(process.cwd(), args.output)
      const ts = report.generatedAt.replace(/[.:]/g, "-")
      return path.join(Global.Path.log, `perf-issue-${ts}.md`)
    })()

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, buildMarkdown(report), "utf8")

    const payload = {
      reportPath: outputPath,
      generatedAt: report.generatedAt,
      totalSessions: report.stats.totalSessions,
      totalMessages: report.stats.totalMessages,
      backendEnabled: report.backend.enabled,
      mockLimits: report.mockLimits,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Performance Issue Report" + UI.Style.TEXT_NORMAL)
    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS + `✓ Report written to ${outputPath}` + UI.Style.TEXT_NORMAL)
    UI.println(`Sessions analyzed: ${report.stats.totalSessions}`)
    UI.println(`Messages analyzed: ${report.stats.totalMessages}`)
    UI.println(`Backend enabled: ${report.backend.enabled ? "yes" : "no"}`)
  },
})
