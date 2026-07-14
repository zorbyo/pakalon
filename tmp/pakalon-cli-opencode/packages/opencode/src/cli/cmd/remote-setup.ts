import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Flag } from "../../flag/flag"
import { Config } from "../../config/config"
import { Filesystem } from "../../util/filesystem"
import { git } from "../../util/git"
import { hasStoredToken } from "../../telegram/token-store"

interface RemoteSetupArgs {
  json?: boolean
}

interface CheckResult {
  name: string
  required: boolean
  ok: boolean
  details: string
}

export const RemoteSetupCommand = cmd({
  command: "remote-setup",
  describe: "run remote-mode preflight checks (teleport/bridge/connect)",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "Output JSON",
    }),
  handler: async (rawArgs) => {
    const args: RemoteSetupArgs = {
      json: Boolean(rawArgs.json),
    }

    const cwd = process.cwd()
    const scriptPath = path.resolve(cwd, "python", "bridge", "server.py")
    const config = await Config.getGlobal()

    const gitResult = await git(["rev-parse", "--is-inside-work-tree"], { cwd })
    const inGitRepo = gitResult.exitCode === 0 && gitResult.text().trim() === "true"

    const bridgeScriptExists = await Filesystem.exists(scriptPath)
    const webhookBaseUrl = process.env["PAKALON_WEBHOOK_BASE_URL"]
    const hasServerPassword = Boolean(Flag.PAKALON_SERVER_PASSWORD)

    let telegramConnected = false
    let telegramMessage = "not configured"
    try {
      telegramConnected = await hasStoredToken()
      telegramMessage = telegramConnected ? "configured" : "not configured"
    } catch (error) {
      telegramMessage = `check failed: ${error instanceof Error ? error.message : String(error)}`
    }

    const checks: CheckResult[] = [
      {
        name: "Git repository",
        required: true,
        ok: inGitRepo,
        details: inGitRepo ? "ok" : "run inside a git repository",
      },
      {
        name: "Bridge script",
        required: true,
        ok: bridgeScriptExists,
        details: bridgeScriptExists ? scriptPath : `missing: ${scriptPath}`,
      },
      {
        name: "Server password",
        required: true,
        ok: hasServerPassword,
        details: hasServerPassword ? "set" : "set PAKALON_SERVER_PASSWORD for secured remote serving",
      },
      {
        name: "Webhook base URL",
        required: false,
        ok: Boolean(webhookBaseUrl),
        details: webhookBaseUrl ?? "set PAKALON_WEBHOOK_BASE_URL for Telegram remote control",
      },
      {
        name: "Backend enabled",
        required: false,
        ok: Flag.PAKALON_ENABLE_BACKEND,
        details: Flag.PAKALON_ENABLE_BACKEND
          ? `enabled (${Flag.PAKALON_BACKEND_URL})`
          : "disabled (set PAKALON_ENABLE_BACKEND=true for account/telegram flows)",
      },
      {
        name: "Telegram connection",
        required: false,
        ok: telegramConnected,
        details: telegramMessage,
      },
      {
        name: "mDNS configuration",
        required: false,
        ok: Boolean(config.server?.mdns),
        details: config.server?.mdns
          ? `enabled (${config.server?.mdnsDomain ?? "pakalon.local"})`
          : "optional: set server.mdns=true in global config for LAN discovery",
      },
    ]

    const requiredPass = checks.filter((c) => c.required && c.ok).length
    const requiredTotal = checks.filter((c) => c.required).length
    const optionalPass = checks.filter((c) => !c.required && c.ok).length
    const optionalTotal = checks.filter((c) => !c.required).length

    const payload = {
      ok: requiredPass === requiredTotal,
      required: { passed: requiredPass, total: requiredTotal },
      optional: { passed: optionalPass, total: optionalTotal },
      checks,
    }

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_HIGHLIGHT + "Remote Setup Preflight" + UI.Style.TEXT_NORMAL)
    UI.empty()

    for (const check of checks) {
      const marker = check.ok ? `${UI.Style.TEXT_SUCCESS}✓${UI.Style.TEXT_NORMAL}` : `${UI.Style.TEXT_WARNING}⚠${UI.Style.TEXT_NORMAL}`
      const tag = check.required ? "required" : "optional"
      UI.println(`${marker} ${check.name} (${tag})`)
      UI.println(UI.Style.TEXT_DIM + `   ${check.details}` + UI.Style.TEXT_NORMAL)
    }

    UI.empty()
    UI.println(`Required checks: ${requiredPass}/${requiredTotal}`)
    UI.println(`Optional checks: ${optionalPass}/${optionalTotal}`)

    if (payload.ok) {
      UI.println(UI.Style.TEXT_SUCCESS + "✓ Remote setup baseline is ready." + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_WARNING + "Some required checks are failing. Resolve them before remote usage." + UI.Style.TEXT_NORMAL)
      process.exitCode = 1
    }
  },
})
