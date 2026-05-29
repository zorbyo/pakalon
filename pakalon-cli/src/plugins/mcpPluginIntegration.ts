/**
 * MCP plugin integration.
 */

import path from 'path'
import { promises as fs } from 'fs'
import type { McpServerConfig, ScopedMcpServerConfig } from '../mcp/types.js'
import { connectToServer } from '../mcp/client.js'
import type { PluginManifest } from './types.js'

export type MCPPluginConfig = ScopedMcpServerConfig & {
  pluginName: string
  pluginId: string
  sourcePath: string
}

export type PluginMcpServer = {
  name: string
  config: MCPPluginConfig
  status: 'stopped' | 'starting' | 'connected' | 'failed'
  connection?: Awaited<ReturnType<typeof connectToServer>>
}

const serversByPlugin = new Map<string, PluginMcpServer[]>()

function pluginIdFromManifest(manifest: PluginManifest): string {
  return manifest.version ? `${manifest.name}@${manifest.version}` : manifest.name
}

function normalizeConfigs(pluginName: string, pluginId: string, sourcePath: string, raw: unknown): MCPPluginConfig[] {
  const entries: MCPPluginConfig[] = []
  if (Array.isArray(raw)) {
    raw.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) return
      entries.push({ ...(item as ScopedMcpServerConfig), scope: 'project', pluginSource: pluginId, pluginName, pluginId, sourcePath })
    })
  } else if (typeof raw === 'object' && raw !== null) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      entries.push({ ...(value as ScopedMcpServerConfig), scope: 'project', pluginSource: pluginId, pluginName, pluginId, sourcePath })
      ;(entries[entries.length - 1] as MCPPluginConfig & { name?: string }).name = name
    }
  }
  return entries
}

export async function loadPluginMcpServers(pluginDir: string, pluginManifest: PluginManifest): Promise<MCPPluginConfig[]> {
  const pluginName = pluginManifest.name
  const pluginId = pluginIdFromManifest(pluginManifest)
  const configs = normalizeConfigs(pluginName, pluginId, pluginDir, pluginManifest.mcpServers)
  return configs
}

export async function startPluginMcpServers(configs: MCPPluginConfig[]): Promise<PluginMcpServer[]> {
  const servers: PluginMcpServer[] = []
  for (const config of configs) {
    const name = (config as unknown as { name?: string }).name ?? config.pluginName
    const server: PluginMcpServer = { name, config, status: 'starting' }
    try {
      server.connection = await connectToServer(name, config)
      server.status = server.connection.type === 'connected' ? 'connected' : 'failed'
    } catch {
      server.status = 'failed'
    }
    servers.push(server)
  }
  for (const server of servers) {
    const list = serversByPlugin.get(server.config.pluginName) ?? []
    list.push(server)
    serversByPlugin.set(server.config.pluginName, list)
  }
  return servers
}

export function stopPluginMcpServers(pluginName: string): boolean {
  const servers = serversByPlugin.get(pluginName)
  if (!servers) return false
  serversByPlugin.delete(pluginName)
  for (const server of servers) {
    void server.connection?.cleanup?.()
  }
  return true
}
