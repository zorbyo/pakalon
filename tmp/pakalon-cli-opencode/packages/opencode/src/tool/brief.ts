import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./brief.txt"
import { Log } from "../util/log"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"

export const log = Log.create({ service: "brief-tool" })

// Image extensions for attachment detection
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"])

interface ResolvedAttachment {
  path: string
  size: number
  isImage: boolean
  exists: boolean
}

/**
 * Resolve attachment paths and gather metadata
 */
async function resolveAttachments(attachmentPaths: string[], cwd: string): Promise<ResolvedAttachment[]> {
  const resolved: ResolvedAttachment[] = []

  for (const attachmentPath of attachmentPaths) {
    const absolutePath = path.isAbsolute(attachmentPath) 
      ? attachmentPath 
      : path.resolve(cwd, attachmentPath)

    const ext = path.extname(absolutePath).toLowerCase()
    const isImage = IMAGE_EXTENSIONS.has(ext)

    try {
      const stat = await fs.stat(absolutePath)
      resolved.push({
        path: absolutePath,
        size: stat.size,
        isImage,
        exists: true,
      })
    } catch {
      resolved.push({
        path: absolutePath,
        size: 0,
        isImage,
        exists: false,
      })
    }
  }

  return resolved
}

/**
 * Validate attachment paths
 */
async function validateAttachmentPaths(attachmentPaths: string[]): Promise<{ valid: boolean; error?: string }> {
  for (const attachmentPath of attachmentPaths) {
    const absolutePath = path.isAbsolute(attachmentPath)
      ? attachmentPath
      : path.resolve(Instance.directory, attachmentPath)

    try {
      await fs.access(absolutePath)
    } catch {
      return {
        valid: false,
        error: `Attachment not found: ${attachmentPath}`,
      }
    }
  }

  return { valid: true }
}

export const BriefTool = Tool.define("brief", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      message: z
        .string()
        .describe("The message for the user. Supports markdown formatting."),
      attachments: z
        .array(z.string())
        .optional()
        .describe(
          "Optional file paths (absolute or relative to cwd) to attach. Use for photos, screenshots, diffs, logs, or any file the user should see alongside your message.",
        ),
      status: z
        .enum(["normal", "proactive"])
        .describe(
          "Use 'proactive' when you're surfacing something the user hasn't asked for and needs to see now — task completion while they're away, a blocker you hit, an unsolicited status update. Use 'normal' when replying to something the user just said.",
        ),
    }),
    async execute(params, ctx) {
      const { message, attachments, status } = params
      const sentAt = new Date().toISOString()

      // Validate attachments if provided
      if (attachments && attachments.length > 0) {
        const validation = await validateAttachmentPaths(attachments)
        if (!validation.valid) {
          throw new Error(validation.error)
        }
      }

      // Resolve attachment metadata
      const resolvedAttachments = attachments && attachments.length > 0
        ? await resolveAttachments(attachments, Instance.directory)
        : []

      const attachmentSummary = resolvedAttachments.length > 0
        ? ` (${resolvedAttachments.length} attachment${resolvedAttachments.length > 1 ? "s" : ""} included)`
        : ""

      log.info("brief message sent", {
        status,
        attachmentCount: resolvedAttachments.length,
        messageLength: message.length,
      })

      return {
        title: status === "proactive" ? "Proactive Update" : "Message",
        metadata: {
          message,
          status,
          sentAt,
          attachments: resolvedAttachments,
        },
        output: `Message delivered to user.${attachmentSummary}`,
      }
    },
  }
})

// Alias for SendUserMessage (legacy name from Claude Code)
export const SendUserMessageTool = BriefTool
