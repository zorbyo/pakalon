import { z } from "zod";
import { registerTool } from "../registry.js";
import { loadMcpTools, type LoadedMcpTools } from "@/mcp/tools.js";
import logger from "@/utils/logger.js";

export interface McpNativeAdapterOptions {
  cwd?: string;
  extraServerUrls?: string[];
}

export interface NativeMcpTool {
  name: string;
  server: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

function convertMcpSchemaToZod(
  inputSchema: Record<string, unknown> | undefined
): z.ZodSchema {
  if (!inputSchema) return z.object({});

  const properties = (inputSchema.properties as Record<string, {
    type?: string;
    description?: string;
    enum?: string[];
  }>) ?? {};

  const required = (inputSchema.required as string[]) ?? [];

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodTypeAny;

    if (prop.enum) {
      fieldSchema = z.enum(prop.enum as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case "number":
        case "integer":
          fieldSchema = z.number();
          break;
        case "boolean":
          fieldSchema = z.boolean();
          break;
        case "array":
          fieldSchema = z.array(z.unknown());
          break;
        case "object":
          fieldSchema = z.record(z.unknown());
          break;
        default:
          fieldSchema = z.string();
      }
    }

    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description);
    }

    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape);
}

export async function loadMcpAsNativeTools(
  options: McpNativeAdapterOptions = {}
): Promise<NativeMcpTool[]> {
  let loadedTools: LoadedMcpTools;
  
  try {
    loadedTools = await loadMcpTools(options.cwd, options.extraServerUrls ?? []);
  } catch (err) {
    logger.warn(`[tools/mcp] Failed to load MCP tools: ${err}`);
    return [];
  }

  const tools: NativeMcpTool[] = [];

  for (const [toolName, toolDef] of Object.entries(loadedTools.tools)) {
    const serverMatch = toolName.match(/^(.+?)__(.+)$/);
    const server = serverMatch ? serverMatch[1] ?? "unknown" : "unknown";
    const description = typeof toolDef.description === "string" ? toolDef.description : `Tool from MCP server '${server}'`;
    
    tools.push({
      name: toolName,
      server,
      description,
      parameters: convertMcpSchemaToZod(toolDef.inputSchema as Record<string, unknown>),
      execute: async (args: Record<string, unknown>) => {
        const executeFn = toolDef.execute;
        if (typeof executeFn === "function") {
          return executeFn(args, { toolCallId: "", messages: [] });
        }
        return { error: "Tool execute function not found" };
      },
    });
  }

  return tools;
}

export function registerMcpAsNativeTools(tools: NativeMcpTool[]): void {
  for (const t of tools) {
    registerTool({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      execute: async (args: Record<string, unknown>) => t.execute(args),
      requiresPermission: true,
    });

    logger.debug(`[tools/mcp] Registered native tool: ${t.name}`);
  }
}

export async function initializeMcpNativeAdapter(
  options?: McpNativeAdapterOptions
): Promise<void> {
  const tools = await loadMcpAsNativeTools(options);
  registerMcpAsNativeTools(tools);
  logger.info(`[tools/mcp] Loaded ${tools.length} MCP tools as native functions`);
}

export { convertMcpSchemaToZod };
