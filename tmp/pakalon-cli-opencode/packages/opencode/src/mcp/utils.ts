/**
 * MCP Utility Functions
 *
 * Shared utilities for MCP operations including filtering, hashing, and validation.
 */

import { createHash } from "crypto"
import type { ScopedMcpServerConfig, ConfigScope } from "./config"
import { normalizeNameForMCP } from "./normalization"

/**
 * Filter tools by MCP server name
 */
export function filterToolsByServer<T extends { name?: string }>(
  tools: T[],
  serverName: string
): T[] {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return tools.filter((tool) => tool.name?.startsWith(prefix))
}

/**
 * Check if a command belongs to a specific MCP server
 */
export function commandBelongsToServer<T extends { name?: string }>(
  command: T,
  serverName: string
): boolean {
  const normalized = normalizeNameForMCP(serverName)
  const name = command.name
  if (!name) return false
  return (
    name.startsWith(`mcp__${normalized}__`) || name.startsWith(`${normalized}:`)
  )
}

/**
 * Filter commands by MCP server name
 */
export function filterCommandsByServer<T extends { name?: string }>(
  commands: T[],
  serverName: string
): T[] {
  return commands.filter((c) => commandBelongsToServer(c, serverName))
}

/**
 * Exclude tools belonging to a specific MCP server
 */
export function excludeToolsByServer<T extends { name?: string }>(
  tools: T[],
  serverName: string
): T[] {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return tools.filter((tool) => !tool.name?.startsWith(prefix))
}

/**
 * Exclude commands belonging to a specific MCP server
 */
export function excludeCommandsByServer<T extends { name?: string }>(
  commands: T[],
  serverName: string
): T[] {
  return commands.filter((c) => !commandBelongsToServer(c, serverName))
}

/**
 * Exclude resources belonging to a specific MCP server
 */
export function excludeResourcesByServer<T>(
  resources: Record<string, T[]>,
  serverName: string
): Record<string, T[]> {
  const result = { ...resources }
  delete result[serverName]
  return result
}

/**
 * Stable hash of an MCP server config for change detection
 * Excludes scope since it's provenance, not content
 */
export function hashMcpConfig(config: ScopedMcpServerConfig): string {
  const { scope: _scope, ...rest } = config
  const stable = JSON.stringify(rest, (_, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
      return sorted
    }
    return v
  })
  return createHash("sha256").update(stable).digest("hex").slice(0, 16)
}

/**
 * Check if a tool name belongs to a specific MCP server
 */
export function isToolFromMcpServer(
  toolName: string,
  serverName: string
): boolean {
  const info = mcpInfoFromString(toolName)
  return info?.serverName === serverName
}

/**
 * Check if a tool is from any MCP server
 */
export function isMcpTool<T extends { name?: string; isMcp?: boolean }>(
  tool: T
): boolean {
  return tool.name?.startsWith("mcp__") || tool.isMcp === true
}

/**
 * Check if a command is from any MCP server
 */
export function isMcpCommand<T extends { name?: string; isMcp?: boolean }>(
  command: T
): boolean {
  return command.name?.startsWith("mcp__") || command.isMcp === true
}

/**
 * Parse MCP tool/command name to extract server and tool info
 */
export function mcpInfoFromString(
  name: string
): { serverName: string; toolName: string } | null {
  if (!name.startsWith("mcp__")) {
    return null
  }

  const parts = name.slice(5).split("__")
  if (parts.length < 2) {
    return null
  }

  return {
    serverName: parts[0]!,
    toolName: parts.slice(1).join("__"),
  }
}

/**
 * Create an MCP tool name from server and tool name
 */
export function createMcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__${toolName}`
}

/**
 * Validate MCP server configuration
 */
export function validateMcpConfig(
  config: ScopedMcpServerConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const type = config.type || "stdio"

  if (type === "stdio") {
    if (!config.command) {
      errors.push("Command is required for stdio transport")
    }
  } else if (type === "sse" || type === "http" || type === "ws") {
    if (!config.url) {
      errors.push(`URL is required for ${type} transport`)
    } else {
      try {
        new URL(config.url)
      } catch {
        errors.push(`Invalid URL: ${config.url}`)
      }
    }
  } else {
    errors.push(`Unknown transport type: ${type}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Get the MCP server base URL (without query string) for logging
 * Query strings are stripped because they can contain access tokens
 */
export function getLoggingSafeMcpBaseUrl(
  config: ScopedMcpServerConfig
): string | undefined {
  if (!config.url) {
    return undefined
  }

  try {
    const url = new URL(config.url)
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

/**
 * Parse headers from array format
 */
export function parseHeaders(headerArray: string[]): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const header of headerArray) {
    const colonIndex = header.indexOf(":")
    if (colonIndex === -1) {
      throw new Error(
        `Invalid header format: "${header}". Expected format: "Header-Name: value"`
      )
    }

    const key = header.substring(0, colonIndex).trim()
    const value = header.substring(colonIndex + 1).trim()

    if (!key) {
      throw new Error(
        `Invalid header: "${header}". Header name cannot be empty.`
      )
    }

    headers[key] = value
  }

  return headers
}

export default {
  filterToolsByServer,
  filterCommandsByServer,
  excludeToolsByServer,
  excludeCommandsByServer,
  excludeResourcesByServer,
  hashMcpConfig,
  isToolFromMcpServer,
  isMcpTool,
  isMcpCommand,
  mcpInfoFromString,
  createMcpToolName,
  validateMcpConfig,
  getLoggingSafeMcpBaseUrl,
  parseHeaders,
}
