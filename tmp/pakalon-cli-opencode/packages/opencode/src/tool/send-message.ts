import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./send-message.txt"
import { Log } from "../util/log"
import { Bus } from "../bus"

export const log = Log.create({ service: "send-message-tool" })

// Message types for structured communication
const StructuredMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("shutdown_request"),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("shutdown_response"),
    request_id: z.string(),
    approve: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("plan_approval_response"),
    request_id: z.string(),
    approve: z.boolean(),
    feedback: z.string().optional(),
  }),
  z.object({
    type: z.literal("task_update"),
    task_id: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "failed"]),
    message: z.string().optional(),
  }),
])

type StructuredMessage = z.infer<typeof StructuredMessageSchema>

// Message interface
interface AgentMessage {
  id: string
  from: string
  to: string
  summary?: string
  content: string | StructuredMessage
  timestamp: string
}

// In-memory message queue (in production, this would be persisted or use a proper messaging system)
const messageQueue: Map<string, AgentMessage[]> = new Map()

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get messages for an agent
 */
export function getMessagesForAgent(agentId: string): AgentMessage[] {
  return messageQueue.get(agentId) ?? []
}

/**
 * Clear messages for an agent
 */
export function clearMessagesForAgent(agentId: string): void {
  messageQueue.delete(agentId)
}

export const SendMessageTool = Tool.define("send_message", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      to: z
        .string()
        .describe(
          'Recipient: agent name, or "*" for broadcast to all teammates',
        ),
      summary: z
        .string()
        .optional()
        .describe(
          "A 5-10 word summary shown as a preview in the UI (required when message is a string)",
        ),
      message: z
        .union([
          z.string().describe("Plain text message content"),
          StructuredMessageSchema,
        ])
        .describe("The message content"),
    }),
    async execute(params, ctx) {
      const { to, summary, message } = params

      // Validate summary for plain text messages
      if (typeof message === "string" && !summary) {
        throw new Error("summary is required when message is a plain text string")
      }

      const messageId = generateMessageId()
      const timestamp = new Date().toISOString()

      // Get sender info from context
      const from = ctx.sessionID // In a real implementation, this would be the agent ID

      const agentMessage: AgentMessage = {
        id: messageId,
        from,
        to,
        summary,
        content: message,
        timestamp,
      }

      // Handle broadcast
      if (to === "*") {
        // In a real implementation, this would broadcast to all registered agents
        log.info("broadcast message", { from, summary, messageId })
        
        // Emit event for subscribers
        Bus.emit({
          type: "agent.message.broadcast",
          properties: {
            messageId,
            from,
            summary,
            timestamp,
          },
        })

        return {
          title: "Message Broadcast",
          metadata: {
            messageId,
            to: "*",
            summary,
            timestamp,
          },
          output: `Message broadcast to all agents. Message ID: ${messageId}`,
        }
      }

      // Queue message for specific recipient
      const recipientMessages = messageQueue.get(to) ?? []
      recipientMessages.push(agentMessage)
      messageQueue.set(to, recipientMessages)

      log.info("message sent", { from, to, summary, messageId })

      // Emit event for subscribers
      Bus.emit({
        type: "agent.message.sent",
        properties: {
          messageId,
          from,
          to,
          summary,
          timestamp,
        },
      })

      // Handle structured message types
      if (typeof message === "object") {
        switch (message.type) {
          case "shutdown_request":
            return {
              title: "Shutdown Request Sent",
              metadata: {
                messageId,
                to,
                type: "shutdown_request",
                reason: message.reason,
                timestamp,
              },
              output: `Shutdown request sent to ${to}. Message ID: ${messageId}`,
            }

          case "shutdown_response":
            return {
              title: "Shutdown Response Sent",
              metadata: {
                messageId,
                to,
                type: "shutdown_response",
                requestId: message.request_id,
                approved: message.approve,
                timestamp,
              },
              output: `Shutdown ${message.approve ? "approved" : "rejected"} for request ${message.request_id}. Message ID: ${messageId}`,
            }

          case "plan_approval_response":
            return {
              title: "Plan Response Sent",
              metadata: {
                messageId,
                to,
                type: "plan_approval_response",
                requestId: message.request_id,
                approved: message.approve,
                timestamp,
              },
              output: `Plan ${message.approve ? "approved" : "rejected"} for request ${message.request_id}. Message ID: ${messageId}`,
            }

          case "task_update":
            return {
              title: "Task Update Sent",
              metadata: {
                messageId,
                to,
                type: "task_update",
                taskId: message.task_id,
                status: message.status,
                timestamp,
              },
              output: `Task update sent to ${to} for task ${message.task_id}. Status: ${message.status}. Message ID: ${messageId}`,
            }
        }
      }

      return {
        title: "Message Sent",
        metadata: {
          messageId,
          to,
          summary,
          timestamp,
        },
        output: `Message sent to ${to}. Message ID: ${messageId}`,
      }
    },
  }
})
