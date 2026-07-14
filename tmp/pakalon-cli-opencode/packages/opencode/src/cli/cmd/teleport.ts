import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"

type TeleportAction = "start" | "stop" | "status" | "list"

interface TeleportArgs {
  action?: string
  sessionID?: string
  limit?: number
  json?: boolean
}

function normalizeAction(value?: string): TeleportAction {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "start") return "start"
  if (normalized === "stop") return "stop"
  if (normalized === "list") return "list"
  return "status"
}

async function resolveSession(sessionID?: string) {
  if (sessionID) {
    return Session.get(SessionID.make(sessionID))
  }
  return [...Session.list({ roots: true, limit: 1 })][0]
}

export const TeleportCommand = cmd({
  command: "teleport [action] [sessionID]",
  describe: "remote session lifecycle (share-based teleport)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["start", "stop", "status", "list"] as const,
        default: "status",
        describe: "Teleport action",
      })
      .positional("sessionID", {
        type: "string",
        describe: "Session ID (defaults to latest root session)",
      })
      .option("limit", {
        alias: "n",
        type: "number",
        default: 20,
        describe: "Max sessions for list",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: TeleportArgs = {
      action: typeof rawArgs.action === "string" ? rawArgs.action : undefined,
      sessionID: typeof rawArgs.sessionID === "string" ? rawArgs.sessionID : undefined,
      limit: typeof rawArgs.limit === "number" ? rawArgs.limit : undefined,
      json: Boolean(rawArgs.json),
    }

    await bootstrap(process.cwd(), async () => {
      const action = normalizeAction(args.action)

      if (action === "list") {
        const limit = Math.max(1, args.limit ?? 20)
        const sessions = [...Session.list({ roots: true, limit })]
        const payload = sessions.map((session) => ({
          id: session.id,
          title: session.title,
          updated: session.time.updated,
          teleport: {
            enabled: Boolean(session.share?.url),
            url: session.share?.url ?? null,
          },
        }))

        if (args.json) {
          console.log(JSON.stringify({ action, sessions: payload }, null, 2))
          return
        }

        UI.println(UI.Style.TEXT_HIGHLIGHT + "Teleport Sessions" + UI.Style.TEXT_NORMAL)
        UI.empty()
        if (payload.length === 0) {
          UI.println(UI.Style.TEXT_DIM + "No sessions found." + UI.Style.TEXT_NORMAL)
          return
        }
        for (const session of payload) {
          UI.println(`${session.id}  ${session.title}`)
          UI.println(
            UI.Style.TEXT_DIM +
              `  updated ${new Date(session.updated).toLocaleString()} · ${session.teleport.enabled ? "shared" : "local"}` +
              UI.Style.TEXT_NORMAL,
          )
          if (session.teleport.url) {
            UI.println(`  ${UI.Style.TEXT_INFO}${session.teleport.url}${UI.Style.TEXT_NORMAL}`)
          }
          UI.empty()
        }
        return
      }

      let session
      try {
        session = await resolveSession(args.sessionID)
      } catch (error) {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exitCode = 1
        return
      }

      if (!session) {
        UI.error("No session available. Start a session first.")
        process.exitCode = 1
        return
      }

      if (action === "status") {
        const payload = {
          action,
          session: {
            id: session.id,
            title: session.title,
            updated: session.time.updated,
            teleport: {
              enabled: Boolean(session.share?.url),
              url: session.share?.url ?? null,
            },
          },
        }
        if (args.json) {
          console.log(JSON.stringify(payload, null, 2))
          return
        }

        UI.println(UI.Style.TEXT_HIGHLIGHT + "Teleport Status" + UI.Style.TEXT_NORMAL)
        UI.empty()
        UI.println(`Session: ${session.id}`)
        UI.println(`Title:   ${session.title}`)
        UI.println(`Updated: ${new Date(session.time.updated).toLocaleString()}`)
        UI.println(`Remote:  ${session.share?.url ? "enabled" : "disabled"}`)
        if (session.share?.url) {
          UI.println(UI.Style.TEXT_INFO + session.share.url + UI.Style.TEXT_NORMAL)
        }
        return
      }

      if (action === "start") {
        if (session.share?.url) {
          if (args.json) {
            console.log(
              JSON.stringify(
                {
                  action,
                  sessionID: session.id,
                  url: session.share.url,
                  created: false,
                },
                null,
                2,
              ),
            )
            return
          }
          UI.println(UI.Style.TEXT_INFO + "Teleport already active:" + UI.Style.TEXT_NORMAL)
          UI.println(session.share.url)
          return
        }

        const share = await Session.share(session.id)
        if (args.json) {
          console.log(
            JSON.stringify(
              {
                action,
                sessionID: session.id,
                url: share.url,
                created: true,
              },
              null,
              2,
            ),
          )
          return
        }

        UI.println(UI.Style.TEXT_SUCCESS + "✓ Teleport enabled" + UI.Style.TEXT_NORMAL)
        UI.println(UI.Style.TEXT_INFO + share.url + UI.Style.TEXT_NORMAL)
        return
      }

      if (!session.share?.url) {
        if (args.json) {
          console.log(JSON.stringify({ action, sessionID: session.id, removed: false, reason: "not-shared" }, null, 2))
          return
        }
        UI.println(UI.Style.TEXT_DIM + "Teleport is already disabled for this session." + UI.Style.TEXT_NORMAL)
        return
      }

      await Session.unshare(session.id)
      if (args.json) {
        console.log(JSON.stringify({ action, sessionID: session.id, removed: true }, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + "✓ Teleport disabled" + UI.Style.TEXT_NORMAL)
    })
  },
})
