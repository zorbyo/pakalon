import open from "open"
import { networkInterfaces } from "os"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Server } from "../../server/server"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"

interface ChromeArgs {
  url?: string
  web?: boolean
  json?: boolean
  port?: number
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    for (const netInfo of net) {
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      if (netInfo.address.startsWith("172.")) continue
      results.push(netInfo.address)
    }
  }

  return results
}

function chromeAppName() {
  if (process.platform === "darwin") return "Google Chrome"
  if (process.platform === "win32") return "chrome"
  return "google-chrome"
}

export const ChromeCommand = cmd({
  command: "chrome [url]",
  describe: "open a URL in Chrome, or launch the local pakalon web server in Chrome",
  builder: (yargs) =>
    withNetworkOptions(
      yargs
        .positional("url", {
          type: "string",
          describe: "URL to open (defaults to https://app.pakalon.ai)",
        })
        .option("web", {
          type: "boolean",
          default: false,
          describe: "Start local pakalon web server and open it in Chrome",
        })
        .option("json", {
          type: "boolean",
          default: false,
          describe: "Output JSON",
        }),
    ),
  handler: async (rawArgs) => {
    const args: ChromeArgs = {
      url: typeof rawArgs.url === "string" ? rawArgs.url : undefined,
      web: Boolean(rawArgs.web),
      json: Boolean(rawArgs.json),
      port: typeof rawArgs.port === "number" ? rawArgs.port : undefined,
      hostname: typeof rawArgs.hostname === "string" ? rawArgs.hostname : undefined,
      mdns: Boolean(rawArgs.mdns),
      mdnsDomain: typeof rawArgs.mdnsDomain === "string" ? rawArgs.mdnsDomain : undefined,
      cors: Array.isArray(rawArgs.cors) ? rawArgs.cors.map(String) : undefined,
    }

    if (!args.web) {
      const target = args.url?.trim() || "https://app.pakalon.ai"
      await open(target, { app: { name: chromeAppName() } })

      if (args.json) {
        console.log(JSON.stringify({ mode: "url", url: target, browser: chromeAppName() }, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + "✓ Opened in Chrome" + UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_INFO + target + UI.Style.TEXT_NORMAL)
      return
    }

    if (!Flag.PAKALON_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "PAKALON_SERVER_PASSWORD is not set; server is unsecured.")
    }

    const opts = await resolveNetworkOptions(rawArgs as any)
    const server = Server.listen(opts)
    const localhostUrl = `http://localhost:${server.port}`

    await open(localhostUrl, { app: { name: chromeAppName() } }).catch(() => undefined)

    const payload = {
      mode: "web",
      port: server.port,
      localhostUrl,
      networkUrls: getNetworkIPs().map((ip) => `http://${ip}:${server.port}`),
      mdnsUrl: opts.mdns ? `${opts.mdnsDomain}:${server.port}` : null,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      UI.empty()
      UI.println(UI.Style.TEXT_HIGHLIGHT + "Chrome Web Mode" + UI.Style.TEXT_NORMAL)
      UI.empty()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      " + UI.Style.TEXT_NORMAL + localhostUrl)

      for (const networkUrl of payload.networkUrls) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Network access:    " + UI.Style.TEXT_NORMAL + networkUrl)
      }

      if (payload.mdnsUrl) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "  mDNS:              " + UI.Style.TEXT_NORMAL + payload.mdnsUrl)
      }

      UI.empty()
      UI.println(UI.Style.TEXT_DIM + "Press Ctrl+C to stop the server." + UI.Style.TEXT_NORMAL)
    }

    await new Promise(() => {})
    await server.stop()
  },
})
