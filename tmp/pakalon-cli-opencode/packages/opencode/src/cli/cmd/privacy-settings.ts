import { cmd } from "./cmd"
import { UI } from "../ui"
import { Config } from "../../config/config"

type PrivacyAction = "status" | "on" | "off"

interface PrivacySettingsArgs {
  action?: string
  json?: boolean
}

function normalizeAction(value?: string): PrivacyAction {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "on") return "on"
  if (normalized === "off") return "off"
  return "status"
}

export const PrivacySettingsCommand = cmd({
  command: "privacy-settings [action]",
  describe: "inspect or update privacy-related settings (telemetry)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["status", "on", "off"] as const,
        default: "status",
        describe: "Set telemetry on/off, or show status",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: PrivacySettingsArgs = {
      action: typeof rawArgs.action === "string" ? rawArgs.action : undefined,
      json: Boolean(rawArgs.json),
    }

    const action = normalizeAction(args.action)

    if (action === "on" || action === "off") {
      await Config.updateGlobal({
        experimental: {
          openTelemetry: action === "on",
        },
      })
    }

    const config = await Config.getGlobal()
    const telemetryEnabled = Boolean(config.experimental?.openTelemetry)
    const telemetryEndpoint = process.env.PAKALON_TELEMETRY_URL ?? null

    const payload = {
      updated: action !== "status",
      telemetry: {
        enabled: telemetryEnabled,
        endpointConfigured: Boolean(telemetryEndpoint),
        endpoint: telemetryEndpoint,
      },
      backend: {
        enabled: process.env.PAKALON_ENABLE_BACKEND === "true",
        url: process.env.PAKALON_BACKEND_URL ?? null,
      },
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Privacy Settings" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (action === "on") {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Telemetry enabled in global config" + UI.Style.TEXT_NORMAL)
    } else if (action === "off") {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Telemetry disabled in global config" + UI.Style.TEXT_NORMAL)
    }

    UI.println(`Telemetry enabled: ${payload.telemetry.enabled ? "yes" : "no"}`)
    UI.println(`Telemetry endpoint configured: ${payload.telemetry.endpointConfigured ? "yes" : "no"}`)
    if (payload.telemetry.endpoint) {
      UI.println(UI.Style.TEXT_DIM + `Endpoint: ${payload.telemetry.endpoint}` + UI.Style.TEXT_NORMAL)
    }

    UI.empty()
    UI.println(`Backend enabled: ${payload.backend.enabled ? "yes" : "no"}`)
    if (payload.backend.url) {
      UI.println(UI.Style.TEXT_DIM + `Backend URL: ${payload.backend.url}` + UI.Style.TEXT_NORMAL)
    }
  },
})
