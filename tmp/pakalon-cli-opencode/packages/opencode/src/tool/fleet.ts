import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./fleet.txt"
import { Log } from "../util/log"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { ModelID, ProviderID } from "@/provider/schema"

const log = Log.create({ service: "fleet-tool" })

export const FleetTool = Tool.define("fleet", async () => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const agentList = agents
    .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
    .join("\n")

  return {
    description: DESCRIPTION + `\n\nAvailable subagent types:\n${agentList}`,
    parameters: z.object({
      tasks: z
        .array(
          z.object({
            description: z.string().describe("A short (3-5 words) description of the task"),
            prompt: z.string().describe("The task for the agent to perform"),
            subagent_type: z.string().describe("The type of specialized agent to use"),
          }),
        )
        .min(1)
        .max(10)
        .describe("Array of tasks to dispatch in parallel (max 10)"),
    }),
    async execute(params, ctx) {
      const config = await Config.get()

      await ctx.ask({
        permission: "task",
        patterns: params.tasks.map((t) => t.subagent_type),
        always: ["*"],
        metadata: {
          description: `Fleet: ${params.tasks.length} parallel tasks`,
          subagent_type: "fleet",
        },
      })

      const results = await Promise.allSettled(
        params.tasks.map(async (task, index) => {
          const agent = await Agent.get(task.subagent_type)
          if (!agent) {
            return {
              description: task.description,
              status: "failed" as const,
              error: `Unknown agent type: ${task.subagent_type}`,
            }
          }

          try {
            const session = await Session.create({
              parentID: ctx.sessionID,
              title: task.description + ` (@${agent.name} fleet-${index})`,
              permission: [
                {
                  permission: "todowrite",
                  pattern: "*",
                  action: "deny",
                },
                {
                  permission: "todoread",
                  pattern: "*",
                  action: "deny",
                },
                {
                  permission: "task",
                  pattern: "*",
                  action: "deny",
                },
                ...(config.experimental?.primary_tools?.map((t) => ({
                  pattern: "*",
                  action: "allow" as const,
                  permission: t,
                })) ?? []),
              ],
            })

            const messageID = MessageID.ascending()
            const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

            const result = await SessionPrompt.prompt({
              messageID,
              sessionID: session.id,
              model: agent.model ?? {
                modelID: ModelID.make("default"),
                providerID: ProviderID.make("default"),
              },
              agent: agent.name,
              tools: {
                todowrite: false,
                todoread: false,
                task: false,
                ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
              },
              parts: promptParts,
            })

            const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

            return {
              description: task.description,
              status: "completed" as const,
              result: text,
              sessionId: session.id,
            }
          } catch (error) {
            return {
              description: task.description,
              status: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      )

      const items = results.map((r, idx) => {
        if (r.status === "fulfilled") return r.value
        return {
          description: params.tasks[idx]?.description ?? "unknown",
          status: "failed" as const,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        }
      })

      const completed = items.filter((i) => i.status === "completed").length
      const failed = items.filter((i) => i.status === "failed").length

      log.info("fleet execution completed", { total: items.length, completed, failed })

      const outputLines = [
        `Fleet: ${completed}/${items.length} tasks completed, ${failed} failed`,
        "",
      ]
      for (const item of items) {
        const mark = item.status === "completed" ? "✓" : "✗"
        outputLines.push(`${mark} ${item.description}`)
        if (item.status === "completed") {
          outputLines.push(`  result: ${item.result?.slice(0, 500)}`)
          if (item.sessionId) outputLines.push(`  session: ${item.sessionId}`)
        } else {
          outputLines.push(`  error: ${item.error}`)
        }
        outputLines.push("")
      }

      return {
        title: `Fleet: ${completed}/${items.length} completed`,
        metadata: {
          total: items.length,
          completed,
          failed,
          tasks: items.map((i) => ({ description: i.description, status: i.status })),
        },
        output: outputLines.join("\n"),
      }
    },
  }
})
