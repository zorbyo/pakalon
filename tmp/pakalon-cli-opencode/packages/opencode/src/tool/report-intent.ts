import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./report-intent.txt"

export const ReportIntentTool = Tool.define("report_intent", {
  description: DESCRIPTION,
  parameters: z.object({
    intent: z.string().describe("A clear description of what you plan to do"),
    steps: z
      .array(z.string())
      .optional()
      .describe("Ordered list of steps you will take to accomplish the task"),
    files: z
      .array(z.string())
      .optional()
      .describe("List of files you expect to read or modify"),
    risks: z
      .string()
      .optional()
      .describe("Any potential risks or side effects the user should be aware of"),
  }),
  async execute(params) {
    const parts: string[] = []
    parts.push(`Intent: ${params.intent}`)

    if (params.steps && params.steps.length > 0) {
      parts.push("")
      parts.push("Steps:")
      params.steps.forEach((step, i) => {
        parts.push(`  ${i + 1}. ${step}`)
      })
    }

    if (params.files && params.files.length > 0) {
      parts.push("")
      parts.push("Files to modify:")
      params.files.forEach((f) => {
        parts.push(`  - ${f}`)
      })
    }

    if (params.risks) {
      parts.push("")
      parts.push(`Risks: ${params.risks}`)
    }

    return {
      title: "Intent reported",
      output: parts.join("\n"),
      metadata: {
        intent: params.intent,
        stepCount: params.steps?.length ?? 0,
        fileCount: params.files?.length ?? 0,
      },
    }
  },
})
