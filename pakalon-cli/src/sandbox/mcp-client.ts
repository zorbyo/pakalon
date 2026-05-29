/**
 * Sandbox MCP Client
 *
 * Connects to the AIO Sandbox's built-in MCP server and exposes
 * its tools (browser_navigate, browser_snapshot, shell_exec,
 * file_read, file_write) for Pakalon agents to use.
 *
 * Uses the same MCP SDK patterns as src/mcp/client.ts but
 * as a lightweight standalone connector for the sandbox.
 *
 * AIO Sandbox MCP endpoint: http://localhost:<port>/mcp
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxMcpTools {
  browser_navigate: (args: { url: string }) => Promise<string>;
  browser_snapshot: (args?: Record<string, unknown>) => Promise<string>;
  shell_exec: (args: { command: string; timeout?: number }) => Promise<string>;
  file_read: (args: { path: string }) => Promise<string>;
  file_write: (args: { path: string; content: string }) => Promise<string>;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

export class SandboxMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private mcpUrl: string;
  private connected = false;
  private toolCache: Tool[] = [];

  constructor(mcpUrl: string) {
    this.mcpUrl = mcpUrl;
  }

  /**
   * Connect to the sandbox MCP server.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    logger.info(`[SandboxMcpClient] Connecting to ${this.mcpUrl}...`);

    try {
      this.transport = new StreamableHTTPClientTransport(
        new URL(this.mcpUrl),
        {
          // Timeout via requestInit signal
          requestInit: {
            signal: AbortSignal.timeout(30_000),
          },
        },
      );

      this.client = new Client(
        {
          name: 'pakalon-sandbox-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        },
      );

      await this.client.connect(this.transport);
      this.connected = true;

      // Cache available tools
      const toolsResult = await this.client.listTools();
      this.toolCache = toolsResult.tools ?? [];

      logger.info(`[SandboxMcpClient] Connected with ${this.toolCache.length} tools`);
      for (const tool of this.toolCache) {
        logger.debug(`[SandboxMcpClient] Tool available: ${tool.name}`);
      }
    } catch (error) {
      this.connected = false;
      logger.error(`[SandboxMcpClient] Connection failed: ${error}`);
      throw error;
    }
  }

  /**
   * Call an MCP tool on the sandbox.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }

    if (!this.client) {
      throw new Error('MCP client not initialized');
    }

    logger.debug(`[SandboxMcpClient] Calling tool: ${toolName}`);

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Extract text content from the response
      if (result.content && Array.isArray(result.content)) {
        const textParts = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text ?? '');
        return textParts.join('\n');
      }

      return String(result);
    } catch (error) {
      logger.error(`[SandboxMcpClient] Tool call ${toolName} failed: ${error}`);
      throw error;
    }
  }

  /**
   * Convenience accessor for typed tool methods.
   */
  get tools(): SandboxMcpTools {
    return {
      browser_navigate: async (args) => this.callTool('browser_navigate', args),
      browser_snapshot: async (args) => this.callTool('browser_snapshot', args ?? {}),
      shell_exec: async (args) => this.callTool('shell_exec', args),
      file_read: async (args) => this.callTool('file_read', args),
      file_write: async (args) => this.callTool('file_write', args),
    };
  }

  /**
   * List available tools from the sandbox MCP server.
   */
  async listTools(): Promise<Tool[]> {
    if (!this.connected) {
      await this.connect();
    }
    if (this.toolCache.length === 0 && this.client) {
      const result = await this.client.listTools();
      this.toolCache = result.tools ?? [];
    }
    return this.toolCache;
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from the sandbox MCP server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    logger.info('[SandboxMcpClient] Disconnecting...');

    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      logger.warn(`[SandboxMcpClient] Disconnect error: ${error}`);
    }

    this.connected = false;
    this.client = null;
    this.transport = null;
    this.toolCache = [];
  }
}

export default SandboxMcpClient;
