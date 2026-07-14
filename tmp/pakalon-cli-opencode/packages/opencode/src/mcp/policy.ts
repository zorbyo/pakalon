import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "mcp-policy" })

export interface MCPPolicy {
  allowedServers?: string[]
  blockedServers?: string[]
  requireApproval?: boolean
}

export namespace MCPPolicy {
  export async function validate(serverName: string, config: Config.Mcp): Promise<{ allowed: boolean; reason?: string }> {
    const cfg = await Config.get()

    // Check for organization-level MCP policies in enterprise config
    const enterpriseConfig = cfg as any
    const policy: MCPPolicy = enterpriseConfig?.mcp_policy ?? {}

    // If an allowlist is defined, only allow servers on the list
    if (policy.allowedServers && policy.allowedServers.length > 0) {
      if (!policy.allowedServers.includes(serverName)) {
        log.warn("MCP server blocked by org policy (not in allowlist)", {
          server: serverName,
          allowedServers: policy.allowedServers,
        })
        return {
          allowed: false,
          reason: `Server "${serverName}" is not in the organization's allowed MCP servers list.`,
        }
      }
    }

    // If a blocklist is defined, block servers on the list
    if (policy.blockedServers && policy.blockedServers.includes(serverName)) {
      log.warn("MCP server blocked by org policy (in blocklist)", {
        server: serverName,
      })
      return {
        allowed: false,
        reason: `Server "${serverName}" is on the organization's blocked MCP servers list.`,
      }
    }

    return { allowed: true }
  }

  export function formatPolicy(policy: MCPPolicy): string {
    const parts: string[] = []

    if (policy.allowedServers && policy.allowedServers.length > 0) {
      parts.push(`Allowed servers: ${policy.allowedServers.join(", ")}`)
    }

    if (policy.blockedServers && policy.blockedServers.length > 0) {
      parts.push(`Blocked servers: ${policy.blockedServers.join(", ")}`)
    }

    if (policy.requireApproval) {
      parts.push("Server additions require approval")
    }

    return parts.join("\n") || "No MCP policies configured"
  }
}
