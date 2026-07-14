import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./read-mcp-resource.txt"
import { Log } from "../util/log"
import { getAllMcpResources } from "./list-mcp-resources"

export const log = Log.create({ service: "read-mcp-resource-tool" })

// Resource content interface
interface ResourceContent {
  uri: string
  mimeType: string
  content: string
  isBase64?: boolean
}

// Resource content cache (in production, this would fetch from MCP servers)
const resourceContentCache: Map<string, ResourceContent> = new Map()

/**
 * Set resource content (for MCP server to populate)
 */
export function setMcpResourceContent(uri: string, content: ResourceContent): void {
  resourceContentCache.set(uri, content)
}

/**
 * Clear resource content
 */
export function clearMcpResourceContent(uri: string): void {
  resourceContentCache.delete(uri)
}

export const ReadMcpResourceTool = Tool.define("read_mcp_resource", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      uri: z
        .string()
        .describe("The resource URI to read"),
    }),
    async execute(params, ctx) {
      const { uri } = params

      // Check if resource exists
      const resources = getAllMcpResources()
      const resource = resources.find((r) => r.uri === uri)

      if (!resource) {
        throw new Error(
          `Resource not found: ${uri}. Use ListMcpResources to discover available resources.`,
        )
      }

      // Check cache for content
      const cached = resourceContentCache.get(uri)

      if (cached) {
        log.info("read mcp resource (cached)", { uri, mimeType: cached.mimeType })

        return {
          title: "MCP Resource",
          metadata: {
            uri: cached.uri,
            mimeType: cached.mimeType,
            isBase64: cached.isBase64,
            size: cached.content.length,
          },
          output: cached.content,
        }
      }

      // In a real implementation, this would fetch from the MCP server
      // For now, return a placeholder indicating the resource needs to be fetched
      log.info("read mcp resource (not cached)", { uri })

      return {
        title: "MCP Resource",
        metadata: {
          uri,
          mimeType: resource.mimeType ?? "application/octet-stream",
          server: resource.server,
        },
        output: `Resource "${resource.name}" (${uri}) is available but content needs to be fetched from MCP server "${resource.server}".`,
      }
    },
  }
})
