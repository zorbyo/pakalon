import { Auth } from "../../auth"
import { DeviceCodeFlow } from "../../auth/device-code"
import * as Backend from "../../backend"
import { UI } from "../ui"
import { ProvidersLoginCommand } from "./providers"
import { cmd } from "./cmd"
import open from "open"

interface LoginArgs {
  provider?: string
  url?: string
  method?: string
  open?: boolean
}

function normalize(value?: string) {
  return value?.trim().toLowerCase()
}

export const LoginCommand = cmd({
  command: "login [provider]",
  describe: "authenticate via Pakalon device code flow or provider credentials",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        type: "string",
        describe: "Provider name/ID (for aliasing to `providers login`)",
      })
      .option("url", {
        type: "string",
        describe: "Well-known provider URL (same as `providers login [url]`)",
      })
      .option("method", {
        alias: ["m"],
        type: "string",
        describe: "Provider login method label (same as `providers login --method`)",
      })
      .option("open", {
        type: "boolean",
        default: true,
        describe: "Automatically open the verification URL in your browser for device login",
      }),
  handler: async (args: LoginArgs) => {
    const provider = normalize(args.provider)

    if ((provider && provider !== "pakalon") || args.url || args.method) {
      await ProvidersLoginCommand.handler?.({
        provider,
        url: args.url,
        method: args.method,
      } as any)
      return
    }

    if (!Backend.isBackendEnabled()) {
      UI.error("Backend auth flow is disabled (PAKALON_ENABLE_BACKEND=false).")
      UI.println(UI.Style.TEXT_DIM + "Use `pakalon providers login` for provider credential login." + UI.Style.TEXT_NORMAL)
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Pakalon Login" + UI.Style.TEXT_NORMAL)
    UI.empty()

    try {
      const deviceCode = await DeviceCodeFlow.generate()
      const code = DeviceCodeFlow.formatCode(deviceCode.code)

      UI.println("Open this URL in your browser:")
      UI.println(`${UI.Style.TEXT_INFO}${deviceCode.url}${UI.Style.TEXT_NORMAL}`)
      UI.empty()
      UI.println("Enter this code:")
      UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}${code}${UI.Style.TEXT_NORMAL}`)
      UI.empty()

      if (args.open !== false) {
        await open(deviceCode.url).catch(() => {
          UI.println(
            UI.Style.TEXT_DIM +
              "Could not open your browser automatically. Please open the URL manually." +
              UI.Style.TEXT_NORMAL,
          )
        })
      }

      UI.println("Waiting for authentication confirmation...")
      const status = await DeviceCodeFlow.waitForAuth(deviceCode)

      if (status.status !== "authorized" || !status.accessToken) {
        UI.error(`Login failed (${status.status}).`)
        return
      }

      await Auth.set("pakalon", {
        type: "api",
        key: status.accessToken,
      })

      UI.println(UI.Style.TEXT_SUCCESS + "✓ Login successful" + UI.Style.TEXT_NORMAL)
      if (status.user?.email) {
        UI.println(`Account: ${status.user.email}`)
      }
      if (status.user?.plan) {
        UI.println(`Plan: ${status.user.plan}`)
      }
    } catch (error) {
      UI.error(`Unable to complete login: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
})
