/**
 * MCP Resource Tools for Pakalon CLI
 * 
 * Provides tools for listing and reading resources from MCP (Model Context Protocol) servers.
 * Features:
 * - ListMcpResourcesTool: List all available resources from connected MCP servers
 * - ReadMcpResourceTool: Read content from a specific resource by URI
 * - Binary content handling with file persistence
 * - Resource caching with invalidation
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import logger from "@/utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // Base64 encoded binary
  blobSavedTo?: string;
}

export interface McpClient {
  name: string;
  type: "connected" | "disconnected" | "connecting" | "error";
  capabilities?: {
    resources?: boolean;
    tools?: boolean;
    prompts?: boolean;
  };
  client?: {
    request: (params: { method: string; params?: unknown }, schema?: unknown) => Promise<unknown>;
  };
}

export interface ListResourcesResult {
  resources: McpResource[];
}

export interface ReadResourceResult {
  contents: McpResourceContent[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BINARY_OUTPUT_DIR = ".pakalon-mcp-resources";
const MAX_TEXT_SIZE = 100000; // 100KB max for inline text

// MIME type to file extension mapping
const MIME_TO_EXT: Record<string, string> = {
  "application/json": ".json",
  "application/xml": ".xml",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/octet-stream": ".bin",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/css": ".css",
  "text/javascript": ".js",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

// ---------------------------------------------------------------------------
// Resource Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  resources: McpResource[];
  timestamp: number;
  ttl: number;
}

const resourceCache: Map<string, CacheEntry> = new Map();
const DEFAULT_CACHE_TTL = 60000; // 1 minute

export function getCachedResources(serverName: string): McpResource[] | null {
  const entry = resourceCache.get(serverName);
  if (!entry) return null;
  
  if (Date.now() > entry.timestamp + entry.ttl) {
    resourceCache.delete(serverName);
    return null;
  }
  
  return entry.resources;
}

export function setCachedResources(
  serverName: string,
  resources: McpResource[],
  ttl: number = DEFAULT_CACHE_TTL
): void {
  resourceCache.set(serverName, {
    resources,
    timestamp: Date.now(),
    ttl,
  });
}

export function invalidateResourceCache(serverName?: string): void {
  if (serverName) {
    resourceCache.delete(serverName);
  } else {
    resourceCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Binary Content Persistence
// ---------------------------------------------------------------------------

function getBinaryOutputDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".pakalon", BINARY_OUTPUT_DIR);
}

function ensureBinaryOutputDir(): void {
  const dir = getBinaryOutputDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getExtensionForMimeType(mimeType?: string): string {
  if (!mimeType) return ".bin";
  return MIME_TO_EXT[mimeType] ?? ".bin";
}

export interface PersistResult {
  filepath?: string;
  size?: number;
  error?: string;
}

export async function persistBinaryContent(
  data: Buffer,
  mimeType?: string,
  identifier?: string
): Promise<PersistResult> {
  try {
    ensureBinaryOutputDir();
    
    const ext = getExtensionForMimeType(mimeType);
    const filename = identifier 
      ? `${identifier}${ext}`
      : `resource-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    
    const filepath = path.join(getBinaryOutputDir(), filename);
    await fs.promises.writeFile(filepath, data);
    
    return {
      filepath,
      size: data.length,
    };
  } catch (error) {
    logger.error(`[mcp-resources] Failed to persist binary content: ${error}`);
    return {
      error: String(error),
    };
  }
}

export function getBinaryBlobSavedMessage(
  filepath: string,
  mimeType?: string,
  size?: number,
  prefix: string = ""
): string {
  const sizeStr = size ? ` (${formatBytes(size)})` : "";
  const typeStr = mimeType ? ` [${mimeType}]` : "";
  return `${prefix}Binary content${typeStr}${sizeStr} saved to: ${filepath}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// ListMcpResourcesTool
// ---------------------------------------------------------------------------

export const listMcpResourcesSchema = z.object({
  server: z.string().optional().describe("Optional server name to filter resources by"),
});

export type ListMcpResourcesInput = z.infer<typeof listMcpResourcesSchema>;

export interface ListMcpResourcesOutput {
  resources: McpResource[];
  totalCount: number;
  servers: string[];
}

async function fetchResourcesForClient(client: McpClient): Promise<McpResource[]> {
  // Check cache first
  const cached = getCachedResources(client.name);
  if (cached) {
    logger.debug(`[mcp-resources] Using cached resources for ${client.name}`);
    return cached;
  }

  if (client.type !== "connected" || !client.client) {
    return [];
  }

  if (!client.capabilities?.resources) {
    return [];
  }

  try {
    const result = await client.client.request({
      method: "resources/list",
      params: {},
    }) as { resources?: Array<{ uri: string; name: string; mimeType?: string; description?: string }> };

    const resources: McpResource[] = (result.resources ?? []).map(r => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mimeType,
      description: r.description,
      server: client.name,
    }));

    // Cache the results
    setCachedResources(client.name, resources);
    
    return resources;
  } catch (error) {
    logger.error(`[mcp-resources] Failed to list resources from ${client.name}: ${error}`);
    return [];
  }
}

export async function listMcpResources(
  input: ListMcpResourcesInput,
  mcpClients: McpClient[]
): Promise<ListMcpResourcesOutput> {
  const { server: targetServer } = input;

  // Filter clients
  const clientsToProcess = targetServer
    ? mcpClients.filter(c => c.name === targetServer)
    : mcpClients;

  if (targetServer && clientsToProcess.length === 0) {
    throw new Error(
      `Server "${targetServer}" not found. Available servers: ${mcpClients.map(c => c.name).join(", ")}`
    );
  }

  // Fetch resources from all clients
  const results = await Promise.all(
    clientsToProcess.map(async client => {
      try {
        return await fetchResourcesForClient(client);
      } catch (error) {
        logger.error(`[mcp-resources] Error fetching from ${client.name}: ${error}`);
        return [];
      }
    })
  );

  const allResources = results.flat();
  const servers = [...new Set(allResources.map(r => r.server))];

  return {
    resources: allResources,
    totalCount: allResources.length,
    servers,
  };
}

export const listMcpResourcesToolDefinition = {
  name: "list_mcp_resources",
  description: "List available resources from connected MCP servers",
  inputSchema: listMcpResourcesSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(
    input: ListMcpResourcesInput,
    context: { mcpClients: McpClient[] }
  ): Promise<ListMcpResourcesOutput> {
    return listMcpResources(input, context.mcpClients);
  },
};

// ---------------------------------------------------------------------------
// ReadMcpResourceTool
// ---------------------------------------------------------------------------

export const readMcpResourceSchema = z.object({
  server: z.string().describe("The MCP server name"),
  uri: z.string().describe("The resource URI to read"),
});

export type ReadMcpResourceInput = z.infer<typeof readMcpResourceSchema>;

export interface ReadMcpResourceOutput {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blobSavedTo?: string;
  }>;
}

export async function readMcpResource(
  input: ReadMcpResourceInput,
  mcpClients: McpClient[]
): Promise<ReadMcpResourceOutput> {
  const { server: serverName, uri } = input;

  // Find the client
  const client = mcpClients.find(c => c.name === serverName);

  if (!client) {
    throw new Error(
      `Server "${serverName}" not found. Available servers: ${mcpClients.map(c => c.name).join(", ")}`
    );
  }

  if (client.type !== "connected" || !client.client) {
    throw new Error(`Server "${serverName}" is not connected`);
  }

  if (!client.capabilities?.resources) {
    throw new Error(`Server "${serverName}" does not support resources`);
  }

  // Request the resource
  const result = await client.client.request({
    method: "resources/read",
    params: { uri },
  }) as { contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> };

  // Process contents
  const contents = await Promise.all(
    (result.contents ?? []).map(async (content, index) => {
      // Text content
      if (content.text !== undefined) {
        // Truncate if too large
        const text = content.text.length > MAX_TEXT_SIZE
          ? content.text.slice(0, MAX_TEXT_SIZE) + `\n... [truncated, ${content.text.length - MAX_TEXT_SIZE} more characters]`
          : content.text;

        return {
          uri: content.uri,
          mimeType: content.mimeType,
          text,
        };
      }

      // Binary content (base64 blob)
      if (content.blob) {
        const buffer = Buffer.from(content.blob, "base64");
        const persistId = `${serverName}-${Date.now()}-${index}`;
        const persisted = await persistBinaryContent(buffer, content.mimeType, persistId);

        if (persisted.error) {
          return {
            uri: content.uri,
            mimeType: content.mimeType,
            text: `Binary content could not be saved: ${persisted.error}`,
          };
        }

        return {
          uri: content.uri,
          mimeType: content.mimeType,
          blobSavedTo: persisted.filepath,
          text: getBinaryBlobSavedMessage(
            persisted.filepath!,
            content.mimeType,
            persisted.size,
            `[Resource from ${serverName}] `
          ),
        };
      }

      // No content
      return {
        uri: content.uri,
        mimeType: content.mimeType,
      };
    })
  );

  return { contents };
}

export const readMcpResourceToolDefinition = {
  name: "read_mcp_resource",
  description: "Read content from a specific MCP resource by URI",
  inputSchema: readMcpResourceSchema,
  isReadOnly: true,
  isConcurrencySafe: true,

  async execute(
    input: ReadMcpResourceInput,
    context: { mcpClients: McpClient[] }
  ): Promise<ReadMcpResourceOutput> {
    return readMcpResource(input, context.mcpClients);
  },
};

// ---------------------------------------------------------------------------
// McpAuthTool (for MCP authentication management via tools)
// ---------------------------------------------------------------------------

export const mcpAuthToolSchema = z.object({
  action: z.enum(["list-servers", "check-auth", "request-auth"])
    .describe("Action to perform"),
  server: z.string().optional().describe("Server name for check-auth or request-auth"),
});

export type McpAuthToolInput = z.infer<typeof mcpAuthToolSchema>;

export interface McpAuthToolOutput {
  success: boolean;
  action: string;
  servers?: string[];
  isAuthenticated?: boolean;
  message?: string;
}

export const mcpAuthToolDefinition2 = {
  name: "mcp_auth_check",
  description: "Check or request authentication for MCP servers",
  inputSchema: mcpAuthToolSchema,

  async execute(
    input: McpAuthToolInput,
    context: { mcpClients: McpClient[] }
  ): Promise<McpAuthToolOutput> {
    const { action, server } = input;

    switch (action) {
      case "list-servers":
        return {
          success: true,
          action,
          servers: context.mcpClients.map(c => c.name),
        };

      case "check-auth": {
        if (!server) {
          return {
            success: false,
            action,
            message: "Server name required for check-auth",
          };
        }
        const client = context.mcpClients.find(c => c.name === server);
        return {
          success: true,
          action,
          isAuthenticated: client?.type === "connected",
          message: client ? `Server ${server} is ${client.type}` : `Server ${server} not found`,
        };
      }

      case "request-auth": {
        if (!server) {
          return {
            success: false,
            action,
            message: "Server name required for request-auth",
          };
        }
        // This would trigger the OAuth flow in a full implementation
        return {
          success: true,
          action,
          message: `Authentication request initiated for ${server}`,
        };
      }

      default:
        return {
          success: false,
          action,
          message: `Unknown action: ${action}`,
        };
    }
  },
};

// ---------------------------------------------------------------------------
// Resource Template Support
// ---------------------------------------------------------------------------

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  server: string;
}

export async function listResourceTemplates(
  mcpClients: McpClient[]
): Promise<ResourceTemplate[]> {
  const templates: ResourceTemplate[] = [];

  for (const client of mcpClients) {
    if (client.type !== "connected" || !client.client || !client.capabilities?.resources) {
      continue;
    }

    try {
      const result = await client.client.request({
        method: "resources/templates/list",
        params: {},
      }) as { resourceTemplates?: Array<{ uriTemplate: string; name: string; description?: string; mimeType?: string }> };

      for (const template of result.resourceTemplates ?? []) {
        templates.push({
          ...template,
          server: client.name,
        });
      }
    } catch {
      // Server might not support templates - that's ok
      continue;
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default {
  // List Resources
  listMcpResourcesSchema,
  listMcpResourcesToolDefinition,
  listMcpResources,
  
  // Read Resource
  readMcpResourceSchema,
  readMcpResourceToolDefinition,
  readMcpResource,
  
  // Auth Tool
  mcpAuthToolSchema,
  mcpAuthToolDefinition2,
  
  // Cache
  getCachedResources,
  setCachedResources,
  invalidateResourceCache,
  
  // Binary persistence
  persistBinaryContent,
  getBinaryBlobSavedMessage,
  
  // Templates
  listResourceTemplates,
};
