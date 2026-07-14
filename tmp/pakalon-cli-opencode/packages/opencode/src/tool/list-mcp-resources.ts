import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./list-mcp-resources.txt"
import { Log } from "../util/log"

export const log = Log.create({ service: "list-mcp-resources-tool" })

// MCP Resource interface
interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
  server: string
}

// In-memory resource registry (in production, this would come from MCP server connections)
const resourceRegistry: Map<string, MCPResource[]> = new Map()

/**
 * Register resources from an MCP server
 */
export function registerMcpResources(server: string, resources: MCPResource[]): void {
  const existing = resourceRegistry.get(server) ?? []
  resourceRegistry.set(server, [...existing, ...resources])
}

/**
 * Clear resources for a server
 */
export function clearMcpResources(server: string): void {
  resourceRegistry.delete(server)
}

/**
 * Get all registered resources
 */
export function getAllMcpResources(): MCPResource[] {
  const all: MCPResource[] = []
  for (const resources of resourceRegistry.values()) {
    all.push(...resources)
  }
  return all
}

export const ListMcpResourcesTool = Tool.define("list_mcp_resources", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      server: z
        .string()
        .optional()
        .describe("Optional: Filter resources by MCP server name"),
    }),
    async execute(params, ctx) {
      const { server } = params

      let resources: MCPResource[]

      if (server) {
        resources = resourceRegistry.get(server) ?? []
      } else {
        resources = getAllMcpResources()
      }

      log.info("list mcp resources", {
        server: server ?? "all",
        count: resources.length,
      })

      if (resources.length === 0) {
        return {
          title: "MCP Resources",
          metadata: {
            count: 0,
            server: server ?? "all",
          },
          output: server
            ? `No resources found for server "${server}"`
            : "No MCP resources available. Connect to an MCP server first.",
        }
      }

      const resourceList = resources
        .map((r) => `- ${r.name} (${r.uri})\n  ${r.description ?? "No description"}\n  Type: ${r.mimeType ?? "unknown"}`)
        .join("\n\n")

      return {
        title: "MCP Resources",
        metadata: {
          count: resources.length,
          server: server ?? "all",
          resources: resources.map((r) => ({
            uri: r.uri,
            name: r.name,
            mimeType: r.mimeType,
          })),
        },
        output: `Found ${resources.length} resource(s):\n\n${resourceList}`,
      }
    },
  }
})
