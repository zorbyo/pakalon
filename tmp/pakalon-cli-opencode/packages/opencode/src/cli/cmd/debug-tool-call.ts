import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"

interface DebugToolCallArgs {
  sessionID?: string
  tool?: string
  limit?: number
  json?: boolean
}

async function resolveSession(sessionID?: string) {
  if (sessionID) {
    return Session.get(SessionID.make(sessionID))
  }
  return [...Session.list({ roots: true, limit: 1 })][0]
}

export const DebugToolCallCommand = cmd({
  command: "debug-tool-call [sessionID]",
  describe: "inspect recent tool calls from session message history",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        type: "string",
        describe: "Session ID (defaults to latest root session)",
      })
      .option("tool", {
        type: "string",
        describe: "Filter by tool name",
      })
      .option("limit", {
        alias: "n",
        type: "number",
        default: 20,
        describe: "Max tool calls to display",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Output JSON",
      }),
  handler: async (rawArgs) => {
    const args: DebugToolCallArgs = {
      sessionID: typeof rawArgs.sessionID === "string" ? rawArgs.sessionID : undefined,
      tool: typeof rawArgs.tool === "string" ? rawArgs.tool : undefined,
      limit: typeof rawArgs.limit === "number" ? rawArgs.limit : undefined,
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

      const messages = await Session.messages({ sessionID: session.id, limit: 300 })
      const calls = messages
        .flatMap((message) =>
          message.parts
            .filter((part) => part.type === "tool")
            .map((part) => {
              const state = part.state
              const start = state.status === "pending" ? undefined : state.time.start
              const end = state.status === "completed" || state.status === "error" ? state.time.end : undefined
              const durationMs = typeof start === "number" && typeof end === "number" ? end - start : undefined

              return {
                messageID: message.info.id,
                partID: part.id,
                tool: part.tool,
                callID: part.callID,
                status: state.status,
                startedAt: start,
                endedAt: end,
                durationMs,
              }
            }),
        )
        .filter((item) => !args.tool || item.tool === args.tool)

      const limit = Math.max(1, args.limit ?? 20)
      const selected = calls.slice(-limit)

      const payload = {
        session: {
          id: session.id,
          title: session.title,
          updated: session.time.updated,
        },
        totalToolCalls: calls.length,
        filter: {
          tool: args.tool ?? null,
          limit,
        },
        calls: selected,
      }

      if (args.json) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      UI.println(UI.Style.TEXT_HIGHLIGHT + "Tool Call Debug" + UI.Style.TEXT_NORMAL)
      UI.empty()
      UI.println(`Session: ${session.id}`)
      UI.println(`Title:   ${session.title}`)
      UI.println(`Total matching calls: ${calls.length}`)
      UI.empty()

      if (selected.length === 0) {
        UI.println(UI.Style.TEXT_DIM + "No tool calls found for the selected filters." + UI.Style.TEXT_NORMAL)
        return
      }

      for (const call of selected) {
        const duration = typeof call.durationMs === "number" ? `${call.durationMs}ms` : "-"
        UI.println(`${call.tool} · ${call.status} · ${duration}`)
        UI.println(UI.Style.TEXT_DIM + `  message=${call.messageID} call=${call.callID}` + UI.Style.TEXT_NORMAL)
      }
    })
  },
})
