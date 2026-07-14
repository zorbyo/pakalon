import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { hasStoredToken } from "../../telegram/token-store"

interface MobileArgs {
  sessionID?: string
  share?: boolean
  json?: boolean
}

async function resolveSession(sessionID?: string) {
  if (sessionID) {
    return Session.get(SessionID.make(sessionID))
  }
  return [...Session.list({ roots: true, limit: 1 })][0]
}

export const MobileCommand = cmd({
  command: "mobile [sessionID]",
  describe: "prepare mobile access for the current session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        type: "string",
        describe: "Session ID (defaults to latest root session)",
      })
      .option("share", {
        type: "boolean",
        default: true,
        describe: "Create a share URL when one does not already exist",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: MobileArgs = {
      sessionID: typeof rawArgs.sessionID === "string" ? rawArgs.sessionID : undefined,
      share: Boolean(rawArgs.share),
      json: Boolean(rawArgs.json),
    }

    await bootstrap(process.cwd(), async () => {
      let session
      try {
        session = await resolveSession(args.sessionID)
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exitCode = 1
        return
      }

      if (!session) {
        UI.error("No session available. Start a session first.")
        process.exitCode = 1
        return
      }

      let url = session.share?.url ?? null
      if (!url && args.share) {
        const shared = await Session.share(session.id)
        url = shared.url
      }

      let telegramConnected = false
      try {
        telegramConnected = await hasStoredToken()
      } catch {
        telegramConnected = false
      }

      const payload = {
        session: {
          id: session.id,
          title: session.title,
          updated: session.time.updated,
        },
        mobile: {
          shared: Boolean(url),
          url,
          telegramConnected,
        },
        hints: [
          "Use `pakalon connect` to enable Telegram remote control",
          "Use `pakalon web --hostname 0.0.0.0 --mdns` for LAN browser access",
        ],
      }

      if (args.json) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_HIGHLIGHT + "Mobile Access" + UI.Style.TEXT_NORMAL)
      UI.empty()
      UI.println(`Session: ${session.id}`)
      UI.println(`Title:   ${session.title}`)
      UI.println(`Updated: ${new Date(session.time.updated).toLocaleString()}`)
      UI.empty()

      if (url) {
        UI.println(UI.Style.TEXT_SUCCESS + "✓ Share URL ready" + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_INFO + url + UI.Style.TEXT_NORMAL)
      } else {
        UI.println(UI.Style.TEXT_WARNING + "No share URL available." + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_DIM + "Re-run with --share to generate one." + UI.Style.TEXT_NORMAL)
      }

      UI.empty()
      UI.println(`Telegram: ${telegramConnected ? "connected" : "not connected"}`)
      if (!telegramConnected) {
        UI.println(UI.Style.TEXT_DIM + "Tip: run `pakalon connect` to pair with Telegram." + UI.Style.TEXT_NORMAL)
      }
    })
  },
})
