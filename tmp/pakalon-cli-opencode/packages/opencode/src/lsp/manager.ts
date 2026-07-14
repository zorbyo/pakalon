/**
 * LSP Manager
 *
 * High-level manager for LSP functionality including server lifecycle,
 * diagnostics, and feature coordination.
 */

import { Log } from "../../util/log"
import { EventEmitter } from "events"
import {
  LspServerManager,
  getLspServerManager,
  type ScopedLspServerConfig,
} from "./server-manager"
import { getAllLspServers } from "./config"
import {
  registerPendingLSPDiagnostic,
  checkForLSPDiagnostics,
  clearAllLSPDiagnostics,
  type DiagnosticFile,
} from "./diagnostic-registry"

/**
 * LSP Manager options
 */
export interface LspManagerOptions {
  autoStart?: boolean
  autoRestart?: boolean
  restartDelay?: number
}

/**
 * LSP Manager
 *
 * Provides a high-level interface for LSP functionality:
 * - Automatic server discovery and startup
 * - Diagnostic aggregation
 * - Feature coordination
 */
export class LspManager extends EventEmitter {
  private serverManager: LspServerManager
  private options: LspManagerOptions
  private initialized: boolean = false

  constructor(options: LspManagerOptions = {}) {
    super()
    this.serverManager = getLspServerManager()
    this.options = {
      autoStart: true,
      autoRestart: true,
      restartDelay: 5000,
      ...options,
    }

    this.setupEventHandlers()
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    this.serverManager.on("serverStarted", (name: string) => {
      this.emit("serverStarted", name)
    })

    this.serverManager.on("serverStopped", (name: string) => {
      this.emit("serverStopped", name)
      if (this.options.autoRestart) {
        this.scheduleRestart(name)
      }
    })

    this.serverManager.on("serverError", (name: string, error: Error) => {
      this.emit("serverError", name, error)
      if (this.options.autoRestart) {
        this.scheduleRestart(name)
      }
    })
  }

  /**
   * Schedule a server restart
   */
  private scheduleRestart(name: string): void {
    setTimeout(() => {
      this.serverManager.startServer(name).catch((error) => {
        Log.error(`Failed to restart LSP server ${name}:`, error)
      })
    }, this.options.restartDelay)
  }

  /**
   * Initialize the LSP manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    Log.info("Initializing LSP Manager")

    try {
      // Load all server configurations
      const { servers, errors } = await getAllLspServers()

      for (const error of errors) {
        Log.error("LSP config error:", error)
      }

      // Register servers
      for (const [name, config] of Object.entries(servers)) {
        this.serverManager.registerServer(config)
      }

      // Auto-start if enabled
      if (this.options.autoStart && Object.keys(servers).length > 0) {
        await this.serverManager.startAll()
      }

      this.initialized = true
      Log.info("LSP Manager initialized")
    } catch (error) {
      Log.error("Failed to initialize LSP Manager:", error)
      throw error
    }
  }

  /**
   * Shutdown the LSP manager
   */
  async shutdown(): Promise<void> {
    Log.info("Shutting down LSP Manager")
    await this.serverManager.stopAll()
    clearAllLSPDiagnostics()
    this.initialized = false
  }

  /**
   * Get diagnostics for all files
   */
  getDiagnostics(): Array<{ serverName: string; files: DiagnosticFile[] }> {
    return checkForLSPDiagnostics()
  }

  /**
   * Register diagnostics from a server
   */
  registerDiagnostics(serverName: string, files: DiagnosticFile[]): void {
    registerPendingLSPDiagnostic({ serverName, files })
  }

  /**
   * Get running servers
   */
  getRunningServers(): string[] {
    return this.serverManager.getRunningServers()
  }

  /**
   * Get registered servers
   */
  getRegisteredServers(): ScopedLspServerConfig[] {
    return this.serverManager.getRegisteredServers()
  }

  /**
   * Start a specific server
   */
  async startServer(name: string): Promise<void> {
    await this.serverManager.startServer(name)
  }

  /**
   * Stop a specific server
   */
  async stopServer(name: string): Promise<void> {
    await this.serverManager.stopServer(name)
  }

  /**
   * Find server for a file
   */
  findServerForFile(filePath: string): string | null {
    return this.serverManager.findServerForFile(filePath)
  }

  /**
   * Register a new server
   */
  registerServer(config: ScopedLspServerConfig): void {
    this.serverManager.registerServer(config)
  }

  /**
   * Unregister a server
   */
  unregisterServer(name: string): void {
    this.serverManager.unregisterServer(name)
  }
}

// Singleton instance
let managerInstance: LspManager | null = null

/**
 * Get the LSP manager instance
 */
export function getLspManager(): LspManager {
  if (!managerInstance) {
    managerInstance = new LspManager()
  }
  return managerInstance
}

export default {
  LspManager,
  getLspManager,
}
