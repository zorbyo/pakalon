import open from "open"
import { cmd } from "./cmd"
import { UI } from "../ui"
import * as Backend from "../../backend"

interface ExtraUsageArgs {
  open?: boolean
  json?: boolean
}

interface BackendSnapshot {
  enabled: boolean
  plan?: string
  credits?: {
    remaining: number
    total: number
    used: number
  }
  startup?: {
    allowed: boolean
    reason?: string
  }
  error?: string
}

async function collectBackendSnapshot(): Promise<BackendSnapshot> {
  if (!Backend.isBackendEnabled()) {
    return { enabled: false }
  }

  try {
    const [credits, startup] = await Promise.all([
      Backend.UsageBackend.getCreditsBalance().catch(() => undefined),
      Backend.UsageBackend.checkStartup().catch(() => undefined),
    ])

    return {
      enabled: true,
      plan: credits?.plan ?? startup?.plan,
      credits: credits
        ? {
            remaining: credits.credits_remaining,
            total: credits.credits_total,
            used: credits.credits_used,
          }
        : undefined,
      startup: startup
        ? {
            allowed: startup.allowed,
            reason: startup.reason,
          }
        : undefined,
    }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const ExtraUsageCommand = cmd({
  command: "extra-usage",
  describe: "show extra-usage/billing guidance and optionally open the billing page",
  builder: (yargs) =>
    yargs
      .option("open", {
        type: "boolean",
        default: false,
        describe: "Open billing/extra-usage page in the browser",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: ExtraUsageArgs = {
      open: Boolean(rawArgs.open),
      json: Boolean(rawArgs.json),
    }

    const manageUrl =
      process.env.PAKALON_USAGE_URL ??
      process.env.PAKALON_BILLING_URL ??
      "https://pakalon.ai/zen"

    const backend = await collectBackendSnapshot()

    let browserOpened = false
    if (args.open) {
      try {
        await open(manageUrl)
        browserOpened = true
      } catch {
        browserOpened = false
      }
    }

    const payload = {
      manageUrl,
      browserOpened,
      backend,
      recommendations: [
        "Use `pakalon rate-limit-options` for actionable paths when limits are hit",
        "Use `pakalon reset-limits` to clear local limit/cache state",
      ],
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Extra Usage" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (backend.enabled) {
      UI.println(`Backend plan: ${backend.plan ?? "unknown"}`)
      if (backend.credits) {
        UI.println(
          `Credits: ${backend.credits.remaining}/${backend.credits.total} remaining (${backend.credits.used} used)`,
        )
      }
      if (backend.startup) {
        UI.println(`Startup allowed: ${backend.startup.allowed ? "yes" : "no"}`)
        if (backend.startup.reason) {
          UI.println(UI.Style.TEXT_DIM + `Reason: ${backend.startup.reason}` + UI.Style.TEXT_NORMAL)
        }
      }
      if (backend.error) {
        UI.println(UI.Style.TEXT_WARNING + `Could not fetch complete backend usage: ${backend.error}` + UI.Style.TEXT_NORMAL)
      }
    } else {
      UI.println("Backend integration is currently disabled.")
    }

    UI.empty()
    UI.println(`Manage extra usage: ${manageUrl}`)
    if (args.open) {
      UI.println(browserOpened ? "Opened in browser." : "Could not auto-open browser. Please open the URL manually.")
    }
  },
})
