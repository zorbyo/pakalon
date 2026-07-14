/**
 * MCP Client Module
 *
 * Provides MCP (Model Context Protocol) client functionality
 * for connecting to MCP servers and invoking tools.
 */

import { Log } from "../../util/log"

/**
 * MCP Server Configuration Types
 */
export type McpTransport = "stdio" | "sse" | "http" | "ws"

export interface McpStdioConfig {
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpSSEConfig {
  type: "sse"
  url: string
  headers?: Record<string, string>
}

export interface McpHTTPConfig {
  type: "http"
  url: string
  headers?: Record<string, string>
}

export interface McpWebSocketConfig {
  type: "ws"
  url: string
  headers?: Record<string, string>
}

export type McpServerConfig =
  | McpStdioConfig
  | McpSSEConfig
  | McpHTTPConfig
  | McpWebSocketConfig

export interface McpServerConnection {
  name: string
  config: McpServerConfig
  status: "connecting" | "connected" | "disconnected" | "error"
  error?: string
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPrompt {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * MCP Client for connecting to MCP servers
 */
export class McpClient {
  private connections: Map<string, McpServerConnection> = new Map()
  private tools: Map<string, McpTool[]> = new Map()
  private resources: Map<string, McpResource[]> = new Map()
  private prompts: Map<string, McpPrompt[]> = new Map()

  /**
   * Connect to an MCP server
   */
  async connect(name: string, config: McpServerConfig): Promise<void> {
    Log.info(`Connecting to MCP server: ${name}`)

    const connection: McpServerConnection = {
      name,
      config,
      status: "connecting",
    }

    this.connections.set(name, connection)

    try {
      // In a full implementation, this would establish the actual connection
      // based on the transport type (stdio, sse, http, ws)
      await this.establishConnection(name, config)

      connection.status = "connected"
      Log.info(`Connected to MCP server: ${name}`)

      // Discover tools, resources, and prompts
      await this.discoverCapabilities(name)
    } catch (error) {
      connection.status = "error"
      connection.error = error instanceof Error ? error.message : String(error)
      Log.error(`Failed to connect to MCP server ${name}:`, connection.error)
      throw error
    }
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(name: string): Promise<void> {
    const connection = this.connections.get(name)
    if (!connection) {
      return
    }

    Log.info(`Disconnecting from MCP server: ${name}`)

    // Clean up resources
    this.tools.delete(name)
    this.resources.delete(name)
    this.prompts.delete(name)

    connection.status = "disconnected"
    this.connections.delete(name)
  }

  /**
   * Get all connected servers
   */
  getConnections(): McpServerConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Get connection by name
   */
  getConnection(name: string): McpServerConnection | undefined {
    return this.connections.get(name)
  }

  /**
   * Get tools from a specific server
   */
  getToolsForServer(serverName: string): McpTool[] {
    return this.tools.get(serverName) || []
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): Array<{ server: string; tool: McpTool }> {
    const result: Array<{ server: string; tool: McpTool }> = []
    for (const [server, tools] of this.tools) {
      for (const tool of tools) {
        result.push({ server, tool })
      }
    }
    return result
  }

  /**
   * Get resources from a specific server
   */
  getResourcesForServer(serverName: string): McpResource[] {
    return this.resources.get(serverName) || []
  }

  /**
   * Get all resources from all connected servers
   */
  getAllResources(): Array<{ server: string; resource: McpResource }> {
    const result: Array<{ server: string; resource: McpResource }> = []
    for (const [server, resources] of this.resources) {
      for (const resource of resources) {
        result.push({ server, resource })
      }
    }
    return result
  }

  /**
   * Get prompts from a specific server
   */
  getPromptsForServer(serverName: string): McpPrompt[] {
    return this.prompts.get(serverName) || []
  }

  /**
   * Invoke a tool on an MCP server
   */
  async invokeTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const connection = this.connections.get(serverName)
    if (!connection || connection.status !== "connected") {
      throw new Error(`MCP server ${serverName} is not connected`)
    }

    const tools = this.tools.get(serverName) || []
    const tool = tools.find((t) => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool ${toolName} not found on server ${serverName}`)
    }

    Log.debug(`Invoking MCP tool: ${serverName}/${toolName}`)

    // In a full implementation, this would send the tool invocation
    // to the MCP server and return the result
    return { result: "Tool invocation placeholder" }
  }

  /**
   * Read a resource from an MCP server
   */
  async readResource(
    serverName: string,
    uri: string
  ): Promise<{ content: string; mimeType?: string }> {
    const connection = this.connections.get(serverName)
    if (!connection || connection.status !== "connected") {
      throw new Error(`MCP server ${serverName} is not connected`)
    }

    Log.debug(`Reading MCP resource: ${serverName}/${uri}`)

    // In a full implementation, this would read the resource
    // from the MCP server
    return { content: "Resource content placeholder" }
  }

  /**
   * Execute a prompt on an MCP server
   */
  async executePrompt(
    serverName: string,
    promptName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const connection = this.connections.get(serverName)
    if (!connection || connection.status !== "connected") {
      throw new Error(`MCP server ${serverName} is not connected`)
    }

    const prompts = this.prompts.get(serverName) || []
    const prompt = prompts.find((p) => p.name === promptName)
    if (!prompt) {
      throw new Error(`Prompt ${promptName} not found on server ${serverName}`)
    }

    Log.debug(`Executing MCP prompt: ${serverName}/${promptName}`)

    // In a full implementation, this would execute the prompt
    // on the MCP server
    return "Prompt execution placeholder"
  }

  /**
   * Establish connection to server (internal)
   */
  private async establishConnection(
    name: string,
    config: McpServerConfig
  ): Promise<void> {
    // Placeholder for actual connection logic
    // This would be implemented based on the transport type
  }

  /**
   * Discover server capabilities (internal)
   */
  private async discoverCapabilities(name: string): Promise<void> {
    // Placeholder for capability discovery
    // This would query the server for available tools, resources, prompts
    this.tools.set(name, [])
    this.resources.set(name, [])
    this.prompts.set(name, [])
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.connections.keys())
    for (const name of names) {
      await this.disconnect(name)
    }
  }
}

// Singleton instance
let clientInstance: McpClient | null = null

/**
 * Get the MCP client instance
 */
export function getMcpClient(): McpClient {
  if (!clientInstance) {
    clientInstance = new McpClient()
  }
  return clientInstance
}

export default {
  McpClient,
  getMcpClient,
}
