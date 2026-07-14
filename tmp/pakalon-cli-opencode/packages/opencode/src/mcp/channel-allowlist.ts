/**
 * MCP Channel Allowlist
 *
 * Manages the allowlist for MCP server channels/transports.
 */

import * as fs from "fs"
import * as path from "path"
import { Log } from "../../util/log"

/**
 * Allowlist entry for an MCP server
 */
export interface AllowlistEntry {
  serverName: string
  allowedAt: number
  scope: "session" | "permanent"
  reason?: string
}

/**
 * Manage MCP channel allowlist
 */
export class ChannelAllowlist {
  private allowlist: Map<string, AllowlistEntry> = new Map()
  private denylist: Set<string> = new Set()
  private persistPath: string | null = null

  constructor(persistPath?: string) {
    this.persistPath = persistPath || null
    if (this.persistPath) {
      this.load()
    }
  }

  /**
   * Check if a server is allowed
   */
  isAllowed(serverName: string): boolean {
    if (this.denylist.has(serverName)) {
      return false
    }
    return this.allowlist.has(serverName)
  }

  /**
   * Check if a server is denied
   */
  isDenied(serverName: string): boolean {
    return this.denylist.has(serverName)
  }

  /**
   * Add a server to the allowlist
   */
  allow(
    serverName: string,
    scope: "session" | "permanent" = "session",
    reason?: string
  ): void {
    this.denylist.delete(serverName)
    this.allowlist.set(serverName, {
      serverName,
      allowedAt: Date.now(),
      scope,
      reason,
    })

    if (scope === "permanent") {
      this.persist()
    }

    Log.info(`Allowed MCP server: ${serverName} (${scope})`)
  }

  /**
   * Add a server to the denylist
   */
  deny(serverName: string): void {
    this.allowlist.delete(serverName)
    this.denylist.add(serverName)
    this.persist()
    Log.info(`Denied MCP server: ${serverName}`)
  }

  /**
   * Remove a server from both lists
   */
  remove(serverName: string): void {
    this.allowlist.delete(serverName)
    this.denylist.delete(serverName)
    this.persist()
    Log.info(`Removed MCP server from allowlist/denylist: ${serverName}`)
  }

  /**
   * Get all allowed servers
   */
  getAllowed(): AllowlistEntry[] {
    return Array.from(this.allowlist.values())
  }

  /**
   * Get all denied servers
   */
  getDenied(): string[] {
    return Array.from(this.denylist)
  }

  /**
   * Clear session-only entries
   */
  clearSession(): void {
    for (const [name, entry] of this.allowlist) {
      if (entry.scope === "session") {
        this.allowlist.delete(name)
      }
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.allowlist.clear()
    this.denylist.clear()
    this.persist()
  }

  /**
   * Load from persistence
   */
  private load(): void {
    if (!this.persistPath) return

    try {
      if (!fs.existsSync(this.persistPath)) return

      const data = JSON.parse(fs.readFileSync(this.persistPath, "utf-8"))

      if (data.allowlist) {
        for (const entry of data.allowlist) {
          if (entry.scope === "permanent") {
            this.allowlist.set(entry.serverName, entry)
          }
        }
      }

      if (data.denylist) {
        for (const name of data.denylist) {
          this.denylist.add(name)
        }
      }
    } catch (error) {
      Log.error("Failed to load channel allowlist:", error)
    }
  }

  /**
   * Persist to storage
   */
  private persist(): void {
    if (!this.persistPath) return

    try {
      const dir = path.dirname(this.persistPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const data = {
        allowlist: Array.from(this.allowlist.values()).filter(
          (e) => e.scope === "permanent"
        ),
        denylist: Array.from(this.denylist),
      }

      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2))
    } catch (error) {
      Log.error("Failed to persist channel allowlist:", error)
    }
  }
}

// Singleton instance
let instance: ChannelAllowlist | null = null

/**
 * Get the channel allowlist instance
 */
export function getChannelAllowlist(): ChannelAllowlist {
  if (!instance) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ""
    const persistPath = path.join(homeDir, ".pakalon", "mcp-allowlist.json")
    instance = new ChannelAllowlist(persistPath)
  }
  return instance
}

export default {
  ChannelAllowlist,
  getChannelAllowlist,
}
