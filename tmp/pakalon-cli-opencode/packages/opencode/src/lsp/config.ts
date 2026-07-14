/**
 * LSP Configuration
 *
 * Handles loading and managing LSP server configurations from plugins.
 */

import { Log } from "../../util/log"
import type { ScopedLspServerConfig } from "./server-manager"

/**
 * LSP configuration result
 */
export interface LspConfigResult {
  servers: Record<string, ScopedLspServerConfig>
  errors: string[]
}

/**
 * Plugin LSP configuration
 */
export interface PluginLspConfig {
  name: string
  lspServers?: Record<string, Omit<ScopedLspServerConfig, "scope" | "pluginName">>
}

/**
 * Get all configured LSP servers from plugins.
 */
export async function getAllLspServers(): Promise<LspConfigResult> {
  const allServers: Record<string, ScopedLspServerConfig> = {}
  const errors: string[] = []

  try {
    // In a full implementation, this would load plugins and extract LSP configs
    // For now, return empty servers
    Log.debug("Loading LSP servers from plugins")

    // Example of how servers would be loaded from plugins:
    // const plugins = await loadAllPlugins()
    // for (const plugin of plugins) {
    //   if (plugin.lspServers) {
    //     for (const [name, config] of Object.entries(plugin.lspServers)) {
    //       allServers[`${plugin.name}:${name}`] = {
    //         ...config,
    //         name: `${plugin.name}:${name}`,
    //         scope: 'plugin',
    //         pluginName: plugin.name
    //       }
    //     }
    //   }
    // }

    Log.debug(`Total LSP servers loaded: ${Object.keys(allServers).length}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push(message)
    Log.error("Error loading LSP servers:", message)
  }

  return {
    servers: allServers,
    errors,
  }
}

/**
 * Get LSP server configuration by name
 */
export function getLspServerConfig(
  servers: Record<string, ScopedLspServerConfig>,
  name: string
): ScopedLspServerConfig | undefined {
  return servers[name]
}

/**
 * Filter servers by language ID
 */
export function filterServersByLanguage(
  servers: Record<string, ScopedLspServerConfig>,
  languageId: string
): ScopedLspServerConfig[] {
  return Object.values(servers).filter(
    (server) => server.languageId === languageId
  )
}

/**
 * Filter servers by file extension
 */
export function filterServersByExtension(
  servers: Record<string, ScopedLspServerConfig>,
  extension: string
): ScopedLspServerConfig[] {
  return Object.values(servers).filter((server) =>
    server.fileExtensions?.includes(extension)
  )
}

/**
 * Default LSP server configurations for common languages
 */
export const DEFAULT_LSP_SERVERS: Record<
  string,
  Omit<ScopedLspServerConfig, "scope">
> = {
  typescript: {
    name: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    languageId: "typescript",
    fileExtensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  python: {
    name: "python",
    command: "pylsp",
    languageId: "python",
    fileExtensions: [".py"],
  },
  rust: {
    name: "rust",
    command: "rust-analyzer",
    languageId: "rust",
    fileExtensions: [".rs"],
  },
  go: {
    name: "go",
    command: "gopls",
    languageId: "go",
    fileExtensions: [".go"],
  },
  json: {
    name: "json",
    command: "vscode-json-languageserver",
    args: ["--stdio"],
    languageId: "json",
    fileExtensions: [".json"],
  },
  yaml: {
    name: "yaml",
    command: "yaml-language-server",
    args: ["--stdio"],
    languageId: "yaml",
    fileExtensions: [".yaml", ".yml"],
  },
}

/**
 * Get default server configuration for a language
 */
export function getDefaultServerConfig(
  languageId: string
): Omit<ScopedLspServerConfig, "scope"> | undefined {
  return DEFAULT_LSP_SERVERS[languageId]
}

export default {
  getAllLspServers,
  getLspServerConfig,
  filterServersByLanguage,
  filterServersByExtension,
  DEFAULT_LSP_SERVERS,
  getDefaultServerConfig,
}
