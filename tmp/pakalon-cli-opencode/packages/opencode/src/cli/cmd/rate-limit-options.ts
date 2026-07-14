import { cmd } from "./cmd"
import { UI } from "../ui"
import * as Backend from "../../backend"
import { readRateLimitMockState } from "./rate-limit-state"

interface RateLimitOptionsArgs {
  json?: boolean
}

interface RateLimitOption {
  id: string
  label: string
  command?: string
  recommended?: boolean
}

export const RateLimitOptionsCommand = cmd({
  command: "rate-limit-options",
  describe: "show actionable options when rate limits block requests",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON",
    }),
  handler: async (rawArgs) => {
    const args: RateLimitOptionsArgs = {
      json: Boolean(rawArgs.json),
    }

    const mock = await readRateLimitMockState()

    const backendEnabled = Backend.isBackendEnabled()
    const [startup, credits] = await Promise.all([
      backendEnabled ? Backend.UsageBackend.checkStartup().catch(() => undefined) : Promise.resolve(undefined),
      backendEnabled ? Backend.UsageBackend.getCreditsBalance().catch(() => undefined) : Promise.resolve(undefined),
    ])

    const blockedByBackend = startup?.allowed === false

    const options: RateLimitOption[] = []

    if (mock.enabled) {
      options.push({
        id: "disable-mock",
        label: "Disable local mock limits",
        command: "pakalon mock-limits off",
        recommended: true,
      })
    }

    if (backendEnabled) {
      options.push({
        id: "extra-usage",
        label: "Open extra usage / billing",
        command: "pakalon extra-usage --open",
        recommended: blockedByBackend,
      })
    }

    options.push(
      {
        id: "switch-model",
        label: "Switch to a lighter/free model",
        command: "pakalon model",
      },
      {
        id: "reset-local",
        label: "Reset local limit/cache state",
        command: "pakalon reset-limits",
      },
      {
        id: "retry-later",
        label: "Wait and retry after cooldown",
      },
    )

    const payload = {
      backend: {
        enabled: backendEnabled,
        startupAllowed: startup?.allowed,
        reason: startup?.reason,
        plan: credits?.plan,
        creditsRemaining: credits?.credits_remaining,
        creditsTotal: credits?.credits_total,
      },
      mock,
      options,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Rate Limit Options" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (backendEnabled) {
      UI.println(`Backend startup allowed: ${startup?.allowed === false ? "no" : "yes"}`)
      if (startup?.reason) {
        UI.println(UI.Style.TEXT_WARNING + `Reason: ${startup.reason}` + UI.Style.TEXT_NORMAL)
      }
      if (typeof credits?.credits_remaining === "number" && typeof credits?.credits_total === "number") {
        UI.println(`Credits: ${credits.credits_remaining}/${credits.credits_total}`)
      }
    } else {
      UI.println("Backend integration is disabled; only local options are available.")
    }

    if (mock.enabled) {
      UI.empty()
      UI.println(UI.Style.TEXT_WARNING + `Mock limits active (${mock.profile})` + UI.Style.TEXT_NORMAL)
      if (mock.reason) UI.println(`Reason: ${mock.reason}`)
    }

    UI.empty()
    for (const option of options) {
      const marker = option.recommended ? `${UI.Style.TEXT_SUCCESS}★${UI.Style.TEXT_NORMAL}` : "-"
      UI.println(`${marker} ${option.label}`)
      if (option.command) {
        UI.println(UI.Style.TEXT_DIM + `    ${option.command}` + UI.Style.TEXT_NORMAL)
      }
    }
  },
})
