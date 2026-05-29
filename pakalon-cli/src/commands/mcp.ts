/**
 * MCP slash command backed by the shared MCP manager.
 */
import type { CommandContext, CommandResult } from "./types.js";
import {
  addMcpServer,
  removeMcpServer,
  listMcpServers,
  enableMcpServer,
  disableMcpServer,
  checkMcpStatus,
  formatMcpStatus,
  discoverMcpServers,
  installMcpServer,
  uninstallMcpServer,
  listVendoredMcpServerPresets,
  importVendoredMcpServers,
  type McpServerConfig,
  type McpScope,
} from "@/mcp/manager.js";
import { summarizeVendoredEverythingAssets } from "@/utils/claude-imports.js";

export interface McpServerStatus {
  name: string;
  status: "configured" | "running" | "stopped" | "error";
  pid?: number;
  error?: string;
  startedAt?: number;
  tools?: string[];
  resources?: number;
  prompts?: number;
}

function inferScope(args: string[]): McpScope {
  return args.includes("--project") ? "project" : "global";
}

function formatServerList(servers: Array<McpServerConfig & { scope: McpScope }>): string {
  if (servers.length === 0) {
    return "No MCP servers configured.";
  }

  const lines = ["Configured MCP servers", "----------------------"];
  for (const server of servers) {
    const transport = server.transport ?? "sse";
    const state = server.enabled === false ? "disabled" : "enabled";
    lines.push(`[${server.scope}] ${server.name} (${transport}, ${state})`);
    lines.push(`  ${server.url}`);
    if (server.description) {
      lines.push(`  ${server.description}`);
    }
  }
  return lines.join("\n");
}

function formatVendoredSources(query?: string): string {
  const summary = summarizeVendoredEverythingAssets();
  const presets = listVendoredMcpServerPresets(query);
  const lines: string[] = [
    "Vendored MCP sources",
    "--------------------",
  ];

  for (const file of summary.mcpConfigPaths) {
    lines.push(`config: ${file}`);
  }
  for (const file of summary.manifestPaths) {
    lines.push(`manifest: ${file}`);
  }
  for (const root of summary.hookRoots) {
    lines.push(`hooks: ${root}`);
  }

  lines.push("");
  if (presets.length === 0) {
    lines.push("No vendored MCP presets found.");
    return lines.join("\n");
  }

  lines.push(`Vendored presets (${presets.length})`);
  for (const preset of presets.slice(0, 50)) {
    lines.push(`${preset.name} [${preset.transport ?? "sse"}]`);
    lines.push(`  ${preset.description ?? preset.url}`);
    lines.push(`  source: ${preset.sourcePath}`);
  }

  return lines.join("\n");
}

export async function loadMcpConfig(): Promise<McpServerConfig[]> {
  return listMcpServers().map(({ scope: _scope, ...server }) => server);
}

export async function saveMcpConfig(_servers: McpServerConfig[]): Promise<void> {
  throw new Error("Direct MCP config overwrite is not supported. Use add/remove/enable/disable/import-vendored.");
}

export async function startMcpServer(config: McpServerConfig): Promise<McpServerStatus> {
  return {
    name: config.name,
    status: "configured",
  };
}

export async function stopMcpServer(name: string): Promise<McpServerStatus> {
  return {
    name,
    status: "stopped",
  };
}

export async function restartMcpServer(name: string): Promise<McpServerStatus> {
  return {
    name,
    status: "configured",
  };
}

export function getAllMcpServerStatuses(): McpServerStatus[] {
  return listMcpServers().map((server) => ({
    name: server.name,
    status: server.enabled === false ? "stopped" : "configured",
  }));
}

export const mcpCommand = {
  name: "mcp",
  aliases: ["servers"],
  description: "Manage MCP servers and vendored MCP presets",
  usage: "/mcp [list|add|remove|enable|disable|check|discover|install|uninstall|sources|import-vendored] [name]",
  category: "mcp" as const,

  async execute(context: CommandContext, args: string[]): Promise<CommandResult> {
    const action = args[0]?.toLowerCase() ?? "list";
    const name = args[1];
    const scope = inferScope(args);
    const cwd = (context as { cwd?: string } | undefined)?.cwd ?? process.cwd();

    switch (action) {
      case "list":
      case "ls":
        return {
          success: true,
          message: formatServerList(listMcpServers(cwd)),
        };

      case "add":
        if (!name || !args[2]) {
          return { success: false, message: "Usage: /mcp add <name> <url-or-command> [--project]" };
        }
        {
          const result = await addMcpServer(name, args[2]!, scope, {
            cwd,
            transport: args[2]!.startsWith("http") ? "sse" : "stdio",
            skipConnCheck: !args[2]!.startsWith("http"),
          });
          return { success: result.ok, message: result.message };
        }

      case "remove":
      case "rm":
        if (!name) {
          return { success: false, message: "Usage: /mcp remove <name> [--project]" };
        }
        {
          const result = removeMcpServer(name, scope, cwd);
          return { success: result.ok, message: result.message };
        }

      case "enable":
        if (!name) {
          return { success: false, message: "Usage: /mcp enable <name> [--project]" };
        }
        {
          const result = enableMcpServer(name, scope, cwd);
          return { success: result.ok, message: result.message };
        }

      case "disable":
        if (!name) {
          return { success: false, message: "Usage: /mcp disable <name> [--project]" };
        }
        {
          const result = disableMcpServer(name, scope, cwd);
          return { success: result.ok, message: result.message };
        }

      case "check":
      case "status":
        return {
          success: true,
          message: formatMcpStatus(await checkMcpStatus(name, cwd)),
        };

      case "discover":
        {
          const query = args.slice(1).join(" ").trim();
          const entries = await discoverMcpServers(query);
          if (entries.length === 0) {
            return { success: true, message: `No MCP registry entries found${query ? ` for "${query}"` : ""}.` };
          }
          return {
            success: true,
            message: entries
              .slice(0, 25)
              .map((entry) => `${entry.name} [${entry.transport}]${entry.installedVersion ? ` [installed v${entry.installedVersion}]` : ""}\n  ${entry.description}`)
              .join("\n"),
          };
        }

      case "install":
        if (!name) {
          return { success: false, message: "Usage: /mcp install <name-or-package> [--project]" };
        }
        {
          const result = await installMcpServer(name, scope, { cwd });
          return { success: result.ok, message: result.message };
        }

      case "uninstall":
        if (!name) {
          return { success: false, message: "Usage: /mcp uninstall <name> [--project]" };
        }
        {
          const result = await uninstallMcpServer(name, scope, { cwd, removePackage: true });
          return { success: result.ok, message: result.message };
        }

      case "sources":
        return {
          success: true,
          message: formatVendoredSources(name),
        };

      case "import-vendored":
        {
          const result = await importVendoredMcpServers({
            scope,
            cwd,
            names: name ? [name] : undefined,
          });
          const lines = [
            `Imported: ${result.imported.length}`,
            ...result.imported.map((entry) => `  + ${entry}`),
            ...(result.skipped.length > 0 ? [`Skipped: ${result.skipped.length}`, ...result.skipped.map((entry) => `  = ${entry}`)] : []),
            ...(result.errors.length > 0 ? [`Errors: ${result.errors.length}`, ...result.errors.map((entry) => `  ! ${entry.name}: ${entry.reason}`)] : []),
          ];
          return {
            success: result.errors.length === 0,
            message: lines.join("\n"),
          };
        }

      default:
        return {
          success: false,
          message: `Unknown action: ${action}\nUsage: /mcp [list|add|remove|enable|disable|check|discover|install|uninstall|sources|import-vendored]`,
        };
    }
  },
};

export default {
  mcpCommand,
  loadMcpConfig,
  saveMcpConfig,
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  getAllMcpServerStatuses,
};
