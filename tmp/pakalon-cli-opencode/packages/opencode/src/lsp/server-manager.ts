/**
 * LSP Server Manager
 *
 * Manages multiple LSP server instances and their lifecycle.
 */

import { Log } from "../../util/log"
import { EventEmitter } from "events"

/**
 * LSP Server configuration
 */
export interface LspServerConfig {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  rootUri?: string
  languageId?: string
  fileExtensions?: string[]
}

/**
 * Scoped LSP server config with source information
 */
export interface ScopedLspServerConfig extends LspServerConfig {
  scope: "plugin" | "user" | "project"
  pluginName?: string
}

/**
 * LSP Server status
 */
export type LspServerStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error"

/**
 * LSP Server instance information
 */
export interface LspServerInstance {
  config: ScopedLspServerConfig
  status: LspServerStatus
  pid?: number
  error?: string
  capabilities?: Record<string, unknown>
}

/**
 * LSP Server Manager events
 */
export interface LspServerManagerEvents {
  serverStarted: (serverName: string) => void
  serverStopped: (serverName: string) => void
  serverError: (serverName: string, error: Error) => void
  diagnosticsReceived: (serverName: string, uri: string) => void
}

/**
 * LSP Server Manager
 *
 * Coordinates LSP server lifecycle and message routing.
 */
export class LspServerManager extends EventEmitter {
  private servers: Map<string, LspServerInstance> = new Map()
  private configs: Map<string, ScopedLspServerConfig> = new Map()

  constructor() {
    super()
  }

  /**
   * Register an LSP server configuration
   */
  registerServer(config: ScopedLspServerConfig): void {
    this.configs.set(config.name, config)
    Log.info(`Registered LSP server: ${config.name}`)
  }

  /**
   * Unregister an LSP server configuration
   */
  unregisterServer(name: string): void {
    this.configs.delete(name)
    Log.info(`Unregistered LSP server: ${name}`)
  }

  /**
   * Start an LSP server
   */
  async startServer(name: string): Promise<void> {
    const config = this.configs.get(name)
    if (!config) {
      throw new Error(`LSP server not registered: ${name}`)
    }

    if (this.servers.has(name)) {
      const instance = this.servers.get(name)!
      if (instance.status === "running" || instance.status === "starting") {
        Log.debug(`LSP server already running: ${name}`)
        return
      }
    }

    Log.info(`Starting LSP server: ${name}`)

    const instance: LspServerInstance = {
      config,
      status: "starting",
    }
    this.servers.set(name, instance)

    try {
      // In a full implementation, this would spawn the LSP server process
      // and establish JSON-RPC communication
      await this.spawnServer(name, config)

      instance.status = "running"
      this.emit("serverStarted", name)
      Log.info(`LSP server started: ${name}`)
    } catch (error) {
      instance.status = "error"
      instance.error = error instanceof Error ? error.message : String(error)
      this.emit("serverError", name, error)
      Log.error(`Failed to start LSP server ${name}:`, instance.error)
      throw error
    }
  }

  /**
   * Stop an LSP server
   */
  async stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name)
    if (!instance) {
      return
    }

    Log.info(`Stopping LSP server: ${name}`)
    instance.status = "stopping"

    try {
      // In a full implementation, this would send shutdown/exit requests
      // and terminate the server process
      await this.terminateServer(name, instance)

      instance.status = "stopped"
      this.servers.delete(name)
      this.emit("serverStopped", name)
      Log.info(`LSP server stopped: ${name}`)
    } catch (error) {
      instance.status = "error"
      instance.error = error instanceof Error ? error.message : String(error)
      Log.error(`Error stopping LSP server ${name}:`, instance.error)
    }
  }

  /**
   * Get server status
   */
  getServerStatus(name: string): LspServerStatus | null {
    const instance = this.servers.get(name)
    return instance?.status ?? null
  }

  /**
   * Get all running servers
   */
  getRunningServers(): string[] {
    const running: string[] = []
    for (const [name, instance] of this.servers) {
      if (instance.status === "running") {
        running.push(name)
      }
    }
    return running
  }

  /**
   * Get all registered servers
   */
  getRegisteredServers(): ScopedLspServerConfig[] {
    return Array.from(this.configs.values())
  }

  /**
   * Get server instance
   */
  getServerInstance(name: string): LspServerInstance | undefined {
    return this.servers.get(name)
  }

  /**
   * Start all registered servers
   */
  async startAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const name of this.configs.keys()) {
      promises.push(
        this.startServer(name).catch((error) => {
          Log.error(`Failed to start LSP server ${name}:`, error)
        })
      )
    }
    await Promise.all(promises)
  }

  /**
   * Stop all running servers
   */
  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const name of this.servers.keys()) {
      promises.push(
        this.stopServer(name).catch((error) => {
          Log.error(`Failed to stop LSP server ${name}:`, error)
        })
      )
    }
    await Promise.all(promises)
  }

  /**
   * Find server for a file
   */
  findServerForFile(filePath: string): string | null {
    for (const [name, config] of this.configs) {
      if (config.fileExtensions) {
        for (const ext of config.fileExtensions) {
          if (filePath.endsWith(ext)) {
            return name
          }
        }
      }
    }
    return null
  }

  /**
   * Spawn server process (internal)
   */
  private async spawnServer(
    name: string,
    config: ScopedLspServerConfig
  ): Promise<void> {
    // Placeholder for actual server spawning
    // This would use child_process.spawn and set up JSON-RPC communication
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  /**
   * Terminate server process (internal)
   */
  private async terminateServer(
    name: string,
    instance: LspServerInstance
  ): Promise<void> {
    // Placeholder for actual server termination
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Singleton instance
let managerInstance: LspServerManager | null = null

/**
 * Get the LSP server manager instance
 */
export function getLspServerManager(): LspServerManager {
  if (!managerInstance) {
    managerInstance = new LspServerManager()
  }
  return managerInstance
}

export default {
  LspServerManager,
  getLspServerManager,
}
