/**
 * Universal MCP Tool - Dynamically invokes any MCP server tool
 *
 * This tool acts as a universal interface to all configured MCP servers.
 * It resolves the server from config and calls the tool with provided arguments.
 *
 * Unlike the native-adapter approach (which converts MCP tools to native tools),
 * this creates a single dynamic tool that can invoke any MCP tool at runtime.
 */

import { z } from "zod";
import { buildTool, type ToolDef } from "../../Tool.js";
import { lazySchema } from "../../utils/lazySchema.js";
import { listMcpServers, type McpServerConfig } from "@/mcp/manager.js";
import { fetchMcpTools, callMcpTool } from "@/mcp/tools.js";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Input/Output Schemas
// ---------------------------------------------------------------------------

const inputSchema = lazySchema(() =>
  z.strictObject({
    server: z.string().describe("Name of the MCP server (e.g., 'filesystem', 'github')"),
    tool: z.string().describe("Name of the tool to invoke on the MCP server"),
    arguments: z.record(z.unknown()).optional().describe("Arguments to pass to the tool"),
  })
);

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    server: z.string(),
    tool: z.string(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })
);

// ---------------------------------------------------------------------------
// MCP Tool Cache - caches discovered tools per server
// ---------------------------------------------------------------------------

interface CachedToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const toolCache = new Map<string, CachedToolInfo[]>();
const CACHE_TTL = 60_000; // 1 minute cache

function getCachedTools(serverName: string): CachedToolInfo[] | null {
  const cached = toolCache.get(serverName);
  if (!cached) return null;
  // Check if cache is still valid
  const timestamp = (cached as unknown as { _cachedAt: number })._cachedAt;
  if (Date.now() - timestamp > CACHE_TTL) {
    toolCache.delete(serverName);
    return null;
  }
  return cached as unknown as CachedToolInfo[];
}

function setCachedTools(serverName: string, tools: CachedToolInfo[]): void {
  toolCache.set(serverName, [...tools, { _cachedAt: Date.now() }] as unknown as CachedToolInfo[]);
}

// ---------------------------------------------------------------------------
// Tool Discovery - get list of available tools from a server
// ---------------------------------------------------------------------------

async function getServerTools(serverName: string): Promise<CachedToolInfo[]> {
  // Check cache first
  const cached = getCachedTools(serverName);
  if (cached) return cached;

  try {
    const servers = listMcpServers();
    const server = servers.find((s) => s.name === serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" not found. Available servers: ${servers.map(s => s.name).join(", ") || "none"}`);
    }

    // Fetch tools from server
    const toolDefs = await fetchMcpTools(server);
    const toolInfos: CachedToolInfo[] = toolDefs.map((def) => ({
      name: def.name,
      description: def.description || `Tool from ${serverName}`,
      inputSchema: def.inputSchema as Record<string, unknown> || {},
    }));
    setCachedTools(serverName, toolInfos);
    return toolInfos;
  } catch (err) {
    logger.warn(`[mcp-tool] Failed to load tools from server "${serverName}": ${err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tool Invocation
// ---------------------------------------------------------------------------

async function invokeMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    // Find the server config
    const servers = listMcpServers();
    const server = servers.find((s) => s.name === serverName);
    if (!server) {
      return { success: false, error: `MCP server "${serverName}" not found` };
    }

    // Call the tool
    const result = await callMcpTool(server, toolName, args);
    return { success: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[mcp-tool] Tool call failed: ${message}`);
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const mcpTool: ToolDef = buildTool({
  name: "mcp",
  searchHint: "mcp, model context protocol, call tool, invoke mcp server",
  maxResultSizeChars: 100_000,
  isMcp: true,

  async description() {
    return "Universal MCP tool - dynamically invoke any tool from any configured MCP server. Use this to access external tools via the Model Context Protocol.";
  },

  async prompt() {
    return `The MCP tool provides access to external tools via the Model Context Protocol.

To use this tool:
1. Specify the 'server' name (e.g., 'filesystem', 'github')
2. Specify the 'tool' name to invoke
3. Provide 'arguments' as a JSON object

Example usage:
- List files: server="filesystem", tool="list_directory", arguments={path: "/path/to/dir"}
- Search web: server="web-search", tool="search", arguments={query: "search term"}

Available servers and their tools depend on your MCP configuration.
Use /mcp list to see configured servers and their tools.`;
  },

  get inputSchema() {
    return inputSchema();
  },

  get outputSchema() {
    return outputSchema();
  },

  async execute(input, _extras) {
    const { server, tool, arguments: args = {} } = input;

    // Validate inputs
    if (!server || typeof server !== "string") {
      return { success: false, server: String(server), tool: String(tool), error: "Server name is required" };
    }
    if (!tool || typeof tool !== "string") {
      return { success: false, server, tool: String(tool), error: "Tool name is required" };
    }

    // Invoke the tool
    const result = await invokeMcpTool(server, tool, args as Record<string, unknown>);

    return {
      success: result.success,
      server,
      tool,
      result: result.result,
      error: result.error,
    };
  },

  async checkPermissions() {
    return { behavior: "prompt" as const, message: "MCP tool requires permission to invoke external tools" };
  },

  renderToolUseMessage(input) {
    return `Calling MCP tool: ${input.server}/${input.tool}`;
  },

  renderToolResultMessage(output) {
    if (!output.success) {
      return `MCP error: ${output.error}`;
    }
    const result = output.result;
    if (typeof result === "string") {
      return result.slice(0, 1000) + (result.length > 1000 ? "..." : "");
    }
    return JSON.stringify(result, null, 2).slice(0, 1000) + (JSON.stringify(result).length > 1000 ? "..." : "");
  },

  isResultTruncated(output) {
    if (!output.result) return false;
    const str = typeof output.result === "string" ? output.result : JSON.stringify(output.result);
    return str.length > 100_000;
  },

  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: "tool_result" as const,
      content: typeof content === "string" ? content : JSON.stringify(content),
    };
  },
});

// ---------------------------------------------------------------------------
// MCP List Helper Tool - Lists available MCP servers and tools
// ---------------------------------------------------------------------------

const listMcpInputSchema = lazySchema(() =>
  z.strictObject({
    server: z.string().optional().describe("Filter by server name"),
  })
);

const listMcpOutputSchema = lazySchema(() =>
  z.object({
    servers: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        transport: z.string(),
        enabled: z.boolean(),
        toolCount: z.number(),
      })
    ),
  })
);

export const listMcpTool: ToolDef = buildTool({
  name: "mcp_list",
  searchHint: "mcp list, list mcp servers, available mcp tools",
  maxResultSizeChars: 50_000,

  async description() {
    return "List all configured MCP servers and their available tools";
  },

  get inputSchema() {
    return listMcpInputSchema();
  },

  get outputSchema() {
    return listMcpOutputSchema();
  },

  async execute(input) {
    try {
      const servers = listMcpServers();
      const filtered = input.server
        ? servers.filter((s) => s.name.includes(input.server!))
        : servers;

      const serverInfos = await Promise.all(
        filtered.map(async (server) => {
          const tools = await getServerTools(server.name);
          return {
            name: server.name,
            description: server.description,
            transport: server.transport || "stdio",
            enabled: server.enabled !== false,
            toolCount: tools.length,
          };
        })
      );

      return { servers: serverInfos };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { servers: [], error: message };
    }
  },

  renderToolResultMessage(output) {
    if (!output.servers || output.servers.length === 0) {
      return "No MCP servers configured. Use /mcp add to add a server.";
    }
    const lines = output.servers.map(
      (s) => `• ${s.name} (${s.transport}) - ${s.toolCount} tools${s.description ? `: ${s.description}` : ""}`
    );
    return ["Available MCP servers:", ...lines].join("\n");
  },
});

// ---------------------------------------------------------------------------
// Export all MCP tools
// ---------------------------------------------------------------------------

export const mcpTools = [mcpTool, listMcpTool];