import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./read-agent.txt"
import { Log } from "../util/log"
import { Session } from "../session"
import { SessionID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"

const log = Log.create({ service: "read-agent-tool" })

export const ReadAgentTool = Tool.define("read_agent", {
  description: DESCRIPTION,
  parameters: z.object({
    session_id: z.string().describe("The session ID of the agent/task to check progress for"),
  }),
  async execute(params: { session_id: string }, ctx: any): Promise<{ title: string; metadata: any; output: string }> {
    const sessionID = SessionID.make(params.session_id)

    try {
      const session = await Session.get(sessionID)
      const messages = await Session.messages({ sessionID })
      const latestMessages = messages.slice(-5)

      const toolCalls = latestMessages
        .filter((m: any) => m.info.role === "assistant")
        .flatMap((m: any) =>
          MessageV2.parts(m.info.id)
            .then((parts: any) => parts.filter((p: any) => p.type === "tool"))
            .catch(() => []),
        )

      const lastAssistantMsg = latestMessages.findLast((m: any) => m.info.role === "assistant")
      const lastText = lastAssistantMsg
        ? await MessageV2.parts(lastAssistantMsg.info.id)
            .then((parts: any) => parts.findLast((p: any) => p.type === "text")?.text ?? "")
            .catch(() => "")
        : ""

      const toolCallsResolved = await Promise.all(toolCalls).catch(() => [])

      const output = [
        `Agent Status: ${session.title}`,
        `Session ID: ${sessionID}`,
        `Messages: ${messages.length}`,
        "",
      ]

      if (lastText) {
        output.push("Latest response:")
        output.push(lastText.slice(0, 500))
        output.push("")
      }

      if (toolCallsResolved.length > 0) {
        output.push(`Tool calls used: ${toolCallsResolved.length}`)
      }

      return {
        title: session.title,
        metadata: {
          sessionId: sessionID,
          messageCount: messages.length,
          status: "active",
        },
        output: output.join("\n"),
      }
    } catch (error) {
      return {
        title: "Agent not found",
        metadata: { sessionId: sessionID, status: "not_found" },
        output: `Could not find agent/session with ID: ${params.session_id}`,
      }
    }
  },
})
