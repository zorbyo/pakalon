import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Pakalon } from "./index"
import path from "path"

const log = Log.create({ service: "pakalon:mcp-project" })

export interface MCPServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPProjectConfig {
  servers: Record<string, MCPServerConfig>
  globalServers?: Record<string, MCPServerConfig>
}

export namespace MCPProjectConfig {
  const GLOBAL_CONFIG_PATH = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".pakalon",
    "mcp.json",
  )

  export async function getProjectConfig(projectPath: string): Promise<MCPProjectConfig> {
    const configPath = path.join(projectPath, Pakalon.DIR_AGENTS, "mcp-servers", "config.json")

    try {
      return await Filesystem.readJson<MCPProjectConfig>(configPath)
    } catch {
      return { servers: {} }
    }
  }

  export async function getGlobalConfig(): Promise<MCPProjectConfig> {
    try {
      return await Filesystem.readJson<MCPProjectConfig>(GLOBAL_CONFIG_PATH)
    } catch {
      return { servers: {} }
    }
  }

  export async function saveProjectConfig(
    projectPath: string,
    config: MCPProjectConfig,
  ): Promise<void> {
    const configPath = path.join(projectPath, Pakalon.DIR_AGENTS, "mcp-servers", "config.json")
    await Filesystem.writeJson(configPath, config)
    log.info("Saved project MCP config", { projectPath })
  }

  export async function saveGlobalConfig(config: MCPProjectConfig): Promise<void> {
    await Filesystem.writeJson(GLOBAL_CONFIG_PATH, config)
    log.info("Saved global MCP config")
  }

  export async function addServer(
    projectPath: string | null,
    server: MCPServerConfig,
    global: boolean = false,
  ): Promise<void> {
    if (global || !projectPath) {
      const config = await getGlobalConfig()
      config.servers[server.name] = server
      await saveGlobalConfig(config)
    } else {
      const config = await getProjectConfig(projectPath)
      config.servers[server.name] = server
      await saveProjectConfig(projectPath, config)
    }

    log.info("Added MCP server", { name: server.name, global })
  }

  export async function removeServer(
    projectPath: string | null,
    serverName: string,
    global: boolean = false,
  ): Promise<void> {
    if (global || !projectPath) {
      const config = await getGlobalConfig()
      delete config.servers[serverName]
      await saveGlobalConfig(config)
    } else {
      const config = await getProjectConfig(projectPath)
      delete config.servers[serverName]
      await saveProjectConfig(projectPath, config)
    }

    log.info("Removed MCP server", { name: serverName, global })
  }

  export async function listServers(
    projectPath: string | null,
  ): Promise<{ global: MCPServerConfig[]; project: MCPServerConfig[] }> {
    const globalConfig = await getGlobalConfig()
    const projectConfig = projectPath ? await getProjectConfig(projectPath) : { servers: {} }

    return {
      global: Object.values(globalConfig.servers),
      project: Object.values(projectConfig.servers),
    }
  }

  export async function getMergedConfig(projectPath: string): Promise<MCPProjectConfig> {
    const globalConfig = await getGlobalConfig()
    const projectConfig = await getProjectConfig(projectPath)

    return {
      servers: {
        ...globalConfig.servers,
        ...projectConfig.servers,
      },
      globalServers: globalConfig.servers,
    }
  }
}

export default MCPProjectConfig
