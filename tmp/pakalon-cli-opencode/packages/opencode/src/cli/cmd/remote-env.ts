import { cmd } from "./cmd"
import { UI } from "../ui"
import { Config } from "../../config/config"

interface RemoteEnvArgs {
  json?: boolean
}

const REMOTE_ENV_KEYS = [
  "PAKALON_SERVER_USERNAME",
  "PAKALON_SERVER_PASSWORD",
  "PAKALON_WEBHOOK_BASE_URL",
  "PAKALON_BACKEND_URL",
  "PAKALON_ENABLE_BACKEND",
  "PAKALON_ENCRYPTION_KEY",
  "BRIDGE_URL",
] as const

function redact(key: string, value?: string): string {
  if (!value) return "(unset)"
  const upper = key.toUpperCase()
  if (upper.includes("KEY") || upper.includes("TOKEN") || upper.includes("PASSWORD") || upper.includes("SECRET")) {
    if (value.length <= 6) return "******"
    return `${value.slice(0, 3)}***${value.slice(-2)}`
  }
  return value
}

export const RemoteEnvCommand = cmd({
  command: "remote-env",
  describe: "show remote/bridge related environment and server config",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON",
    }),
  handler: async (rawArgs) => {
    const args: RemoteEnvArgs = {
      json: Boolean(rawArgs.json),
    }

    const config = await Config.getGlobal()
    const env = REMOTE_ENV_KEYS.map((key) => ({
      key,
      set: Boolean(process.env[key]),
      value: redact(key, process.env[key]),
    }))

    const payload = {
      env,
      config: {
        server: {
          hostname: config.server?.hostname ?? null,
          port: config.server?.port ?? null,
          mdns: config.server?.mdns ?? null,
          mdnsDomain: config.server?.mdnsDomain ?? null,
        },
      },
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Remote Environment" + UI.Style.TEXT_NORMAL)
    UI.empty()
    for (const row of env) {
      UI.println(`${row.key}: ${row.value}`)
    }

    UI.empty()
    UI.println(UI.Style.TEXT_INFO + "Server config" + UI.Style.TEXT_NORMAL)
    UI.println(`hostname: ${payload.config.server.hostname ?? "(default)"}`)
    UI.println(`port:     ${payload.config.server.port ?? "(default)"}`)
    UI.println(`mdns:     ${payload.config.server.mdns ?? "(default)"}`)
    UI.println(`mdnsDomain: ${payload.config.server.mdnsDomain ?? "(default)"}`)
  },
})
