/**
 * MCP Configuration Module
 *
 * Handles loading and managing MCP server configurations from various sources.
 */

import * as fs from "fs"
import * as path from "path"
import { Log } from "../../util/log"

/**
 * Configuration scope - where the config came from
 */
export type ConfigScope =
  | "user"
  | "project"
  | "local"
  | "dynamic"
  | "enterprise"

/**
 * MCP server configuration with scope
 */
export interface ScopedMcpServerConfig {
  type?: "stdio" | "sse" | "http" | "ws"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  cwd?: string
  scope: ConfigScope
}

/**
 * MCP configuration file format
 */
export interface McpConfigFile {
  mcpServers?: Record<string, Omit<ScopedMcpServerConfig, "scope">>
}

/**
 * Load MCP configuration from a file
 */
export function loadMcpConfigFile(filePath: string): McpConfigFile | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const content = fs.readFileSync(filePath, "utf-8")
    return JSON.parse(content) as McpConfigFile
  } catch (error) {
    Log.error(`Failed to load MCP config from ${filePath}:`, error)
    return null
  }
}

/**
 * Get the project MCP config file path
 */
export function getProjectMcpConfigPath(): string {
  return path.join(process.cwd(), ".mcp.json")
}

/**
 * Get the user MCP config file path
 */
export function getUserMcpConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  return path.join(homeDir, ".claude", "mcp.json")
}

/**
 * Load all MCP server configurations
 */
export function loadAllMcpConfigs(): Record<string, ScopedMcpServerConfig> {
  const configs: Record<string, ScopedMcpServerConfig> = {}

  // Load user config
  const userConfig = loadMcpConfigFile(getUserMcpConfigPath())
  if (userConfig?.mcpServers) {
    for (const [name, config] of Object.entries(userConfig.mcpServers)) {
      configs[name] = { ...config, scope: "user" }
    }
  }

  // Load project config (overrides user config)
  const projectConfig = loadMcpConfigFile(getProjectMcpConfigPath())
  if (projectConfig?.mcpServers) {
    for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
      configs[name] = { ...config, scope: "project" }
    }
  }

  return configs
}

/**
 * Get MCP configuration by server name
 */
export function getMcpConfigByName(
  name: string
): ScopedMcpServerConfig | undefined {
  const configs = loadAllMcpConfigs()
  return configs[name]
}

/**
 * Save MCP configuration to a file
 */
export function saveMcpConfig(
  scope: ConfigScope,
  name: string,
  config: Omit<ScopedMcpServerConfig, "scope">
): void {
  const filePath =
    scope === "project" ? getProjectMcpConfigPath() : getUserMcpConfigPath()

  let existingConfig = loadMcpConfigFile(filePath) || { mcpServers: {} }

  if (!existingConfig.mcpServers) {
    existingConfig.mcpServers = {}
  }

  existingConfig.mcpServers[name] = config

  // Ensure directory exists
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(filePath, JSON.stringify(existingConfig, null, 2))
  Log.info(`Saved MCP config for ${name} to ${filePath}`)
}

/**
 * Remove MCP configuration
 */
export function removeMcpConfig(scope: ConfigScope, name: string): boolean {
  const filePath =
    scope === "project" ? getProjectMcpConfigPath() : getUserMcpConfigPath()

  const existingConfig = loadMcpConfigFile(filePath)
  if (!existingConfig?.mcpServers?.[name]) {
    return false
  }

  delete existingConfig.mcpServers[name]
  fs.writeFileSync(filePath, JSON.stringify(existingConfig, null, 2))
  Log.info(`Removed MCP config for ${name} from ${filePath}`)
  return true
}

/**
 * Get description of config file path for a scope
 */
export function describeMcpConfigFilePath(scope: ConfigScope): string {
  switch (scope) {
    case "user":
      return getUserMcpConfigPath()
    case "project":
      return getProjectMcpConfigPath()
    case "local":
      return `${getUserMcpConfigPath()} [project: ${process.cwd()}]`
    case "dynamic":
      return "Dynamically configured"
    case "enterprise":
      return "Enterprise configuration"
    default:
      return scope
  }
}

/**
 * Get label for config scope
 */
export function getScopeLabel(scope: ConfigScope): string {
  switch (scope) {
    case "local":
      return "Local config (private to you in this project)"
    case "project":
      return "Project config (shared via .mcp.json)"
    case "user":
      return "User config (available in all your projects)"
    case "dynamic":
      return "Dynamic config (from command line)"
    case "enterprise":
      return "Enterprise config (managed by your organization)"
    default:
      return scope
  }
}

export default {
  loadMcpConfigFile,
  loadAllMcpConfigs,
  getMcpConfigByName,
  saveMcpConfig,
  removeMcpConfig,
  getProjectMcpConfigPath,
  getUserMcpConfigPath,
  describeMcpConfigFilePath,
  getScopeLabel,
}
