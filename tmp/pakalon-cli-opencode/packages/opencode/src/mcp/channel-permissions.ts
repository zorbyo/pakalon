/**
 * MCP Channel Permissions
 *
 * Manages permissions for MCP server channels including tool access and resource access.
 */

import * as fs from "fs"
import * as path from "path"
import { Log } from "../../util/log"
import { normalizeNameForMCP } from "./normalization"

/**
 * Permission level for a resource or tool
 */
export type PermissionLevel = "allow" | "deny" | "ask"

/**
 * Permission entry for a tool
 */
export interface ToolPermission {
  toolName: string
  serverName: string
  level: PermissionLevel
  grantedAt?: number
  expiresAt?: number
}

/**
 * Permission entry for a resource
 */
export interface ResourcePermission {
  uri: string
  serverName: string
  level: PermissionLevel
  grantedAt?: number
}

/**
 * Channel permissions manager
 */
export class ChannelPermissions {
  private toolPermissions: Map<string, ToolPermission> = new Map()
  private resourcePermissions: Map<string, ResourcePermission> = new Map()
  private defaultLevel: PermissionLevel = "ask"
  private persistPath: string | null = null

  constructor(persistPath?: string) {
    this.persistPath = persistPath || null
    if (this.persistPath) {
      this.load()
    }
  }

  /**
   * Get permission key for a tool
   */
  private getToolKey(serverName: string, toolName: string): string {
    return `${normalizeNameForMCP(serverName)}__${toolName}`
  }

  /**
   * Get permission key for a resource
   */
  private getResourceKey(serverName: string, uri: string): string {
    return `${normalizeNameForMCP(serverName)}__${uri}`
  }

  /**
   * Check if a tool is allowed
   */
  isToolAllowed(serverName: string, toolName: string): PermissionLevel {
    const key = this.getToolKey(serverName, toolName)
    const permission = this.toolPermissions.get(key)

    if (!permission) {
      return this.defaultLevel
    }

    // Check expiration
    if (permission.expiresAt && Date.now() > permission.expiresAt) {
      this.toolPermissions.delete(key)
      return this.defaultLevel
    }

    return permission.level
  }

  /**
   * Check if a resource is allowed
   */
  isResourceAllowed(serverName: string, uri: string): PermissionLevel {
    const key = this.getResourceKey(serverName, uri)
    const permission = this.resourcePermissions.get(key)
    return permission?.level ?? this.defaultLevel
  }

  /**
   * Set tool permission
   */
  setToolPermission(
    serverName: string,
    toolName: string,
    level: PermissionLevel,
    expiresIn?: number
  ): void {
    const key = this.getToolKey(serverName, toolName)
    const permission: ToolPermission = {
      toolName,
      serverName,
      level,
      grantedAt: Date.now(),
    }

    if (expiresIn) {
      permission.expiresAt = Date.now() + expiresIn
    }

    this.toolPermissions.set(key, permission)
    this.persist()

    Log.debug(`Set tool permission: ${key} = ${level}`)
  }

  /**
   * Set resource permission
   */
  setResourcePermission(
    serverName: string,
    uri: string,
    level: PermissionLevel
  ): void {
    const key = this.getResourceKey(serverName, uri)
    const permission: ResourcePermission = {
      uri,
      serverName,
      level,
      grantedAt: Date.now(),
    }

    this.resourcePermissions.set(key, permission)
    this.persist()

    Log.debug(`Set resource permission: ${key} = ${level}`)
  }

  /**
   * Get all tool permissions for a server
   */
  getToolPermissionsForServer(serverName: string): ToolPermission[] {
    const prefix = normalizeNameForMCP(serverName) + "__"
    const result: ToolPermission[] = []

    for (const [key, permission] of this.toolPermissions) {
      if (key.startsWith(prefix)) {
        result.push(permission)
      }
    }

    return result
  }

  /**
   * Get all resource permissions for a server
   */
  getResourcePermissionsForServer(serverName: string): ResourcePermission[] {
    const prefix = normalizeNameForMCP(serverName) + "__"
    const result: ResourcePermission[] = []

    for (const [key, permission] of this.resourcePermissions) {
      if (key.startsWith(prefix)) {
        result.push(permission)
      }
    }

    return result
  }

  /**
   * Clear all permissions for a server
   */
  clearServerPermissions(serverName: string): void {
    const prefix = normalizeNameForMCP(serverName) + "__"

    for (const key of this.toolPermissions.keys()) {
      if (key.startsWith(prefix)) {
        this.toolPermissions.delete(key)
      }
    }

    for (const key of this.resourcePermissions.keys()) {
      if (key.startsWith(prefix)) {
        this.resourcePermissions.delete(key)
      }
    }

    this.persist()
    Log.info(`Cleared permissions for server: ${serverName}`)
  }

  /**
   * Clear all permissions
   */
  clearAll(): void {
    this.toolPermissions.clear()
    this.resourcePermissions.clear()
    this.persist()
  }

  /**
   * Set default permission level
   */
  setDefaultLevel(level: PermissionLevel): void {
    this.defaultLevel = level
  }

  /**
   * Load permissions from persistence
   */
  private load(): void {
    if (!this.persistPath) return

    try {
      if (!fs.existsSync(this.persistPath)) return

      const data = JSON.parse(fs.readFileSync(this.persistPath, "utf-8"))

      if (data.tools) {
        for (const permission of data.tools) {
          const key = this.getToolKey(permission.serverName, permission.toolName)
          this.toolPermissions.set(key, permission)
        }
      }

      if (data.resources) {
        for (const permission of data.resources) {
          const key = this.getResourceKey(permission.serverName, permission.uri)
          this.resourcePermissions.set(key, permission)
        }
      }

      if (data.defaultLevel) {
        this.defaultLevel = data.defaultLevel
      }
    } catch (error) {
      Log.error("Failed to load channel permissions:", error)
    }
  }

  /**
   * Persist permissions to storage
   */
  private persist(): void {
    if (!this.persistPath) return

    try {
      const dir = path.dirname(this.persistPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const data = {
        tools: Array.from(this.toolPermissions.values()),
        resources: Array.from(this.resourcePermissions.values()),
        defaultLevel: this.defaultLevel,
      }

      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2))
    } catch (error) {
      Log.error("Failed to persist channel permissions:", error)
    }
  }
}

// Singleton instance
let instance: ChannelPermissions | null = null

/**
 * Get the channel permissions instance
 */
export function getChannelPermissions(): ChannelPermissions {
  if (!instance) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ""
    const persistPath = path.join(homeDir, ".pakalon", "mcp-permissions.json")
    instance = new ChannelPermissions(persistPath)
  }
  return instance
}

export default {
  ChannelPermissions,
  getChannelPermissions,
}
