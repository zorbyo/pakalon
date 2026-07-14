import { cmd } from "./cmd"
import { UI } from "../ui"
import {
  type RateLimitMockProfile,
  clearRateLimitMockState,
  getRateLimitMockFilePath,
  readRateLimitMockState,
  writeRateLimitMockState,
} from "./rate-limit-state"

interface MockLimitsArgs {
  profile?: string
  reason?: string
  status?: boolean
  json?: boolean
}

function normalizeProfile(value?: string): RateLimitMockProfile | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === "off") return "off"
  if (normalized === "soft") return "soft"
  if (normalized === "hard") return "hard"
  if (normalized === "extra-usage-required") return "extra-usage-required"
  return undefined
}

export const MockLimitsCommand = cmd({
  command: "mock-limits [profile]",
  describe: "configure local mock rate-limit profiles for diagnostics/testing",
  builder: (yargs) =>
    yargs
      .positional("profile", {
        type: "string",
        choices: ["off", "soft", "hard", "extra-usage-required"] as const,
        describe: "Mock profile to set",
      })
      .option("reason", {
        type: "string",
        describe: "Optional note stored with the mock profile",
      })
      .option("status", {
        type: "boolean",
        default: false,
        describe: "Show current mock profile without changing it",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: MockLimitsArgs = {
      profile: typeof rawArgs.profile === "string" ? rawArgs.profile : undefined,
      reason: typeof rawArgs.reason === "string" ? rawArgs.reason : undefined,
      status: Boolean(rawArgs.status),
      json: Boolean(rawArgs.json),
    }

    const normalized = normalizeProfile(args.profile)

    let updated = false
    if (!args.status && normalized) {
      if (normalized === "off") {
        await clearRateLimitMockState()
        delete process.env.PAKALON_MOCK_LIMIT_PROFILE
      } else {
        await writeRateLimitMockState(normalized, args.reason)
        process.env.PAKALON_MOCK_LIMIT_PROFILE = normalized
      }
      updated = true
    }

    const state = await readRateLimitMockState()

    const payload = {
      updated,
      file: getRateLimitMockFilePath(),
      state,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Mock Limits" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (updated) {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Mock limit profile updated" + UI.Style.TEXT_NORMAL)
      UI.empty()
    }

    UI.println(`Enabled: ${state.enabled ? "yes" : "no"}`)
    UI.println(`Profile: ${state.profile}`)
    if (state.reason) UI.println(`Reason: ${state.reason}`)
    if (state.updatedAt) UI.println(`Updated: ${state.updatedAt}`)
    UI.println(UI.Style.TEXT_DIM + `State file: ${payload.file}` + UI.Style.TEXT_NORMAL)
  },
})
