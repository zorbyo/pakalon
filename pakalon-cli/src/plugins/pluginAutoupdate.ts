/**
 * Plugin auto-update helpers.
 */

import { promises as fs } from 'fs'
import path from 'path'

export type PluginAutoupdateConfig = {
  channel?: 'stable' | 'beta' | 'dev'
  intervalMs?: number
  enabled?: boolean
}

export type PluginUpdateInfo = {
  pluginName: string
  currentVersion: string
  latestVersion: string
  changelog?: string
  downloadUrl?: string
  channel?: 'stable' | 'beta' | 'dev'
}

const scheduledUpdates = new Map<string, ReturnType<typeof setInterval>>()

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function checkForUpdates(
  pluginName: string,
  currentVersion: string,
  registryUrl: string,
): Promise<PluginUpdateInfo | null> {
  const data = await fetchJson(registryUrl)
  const latestVersion = data?.version ?? data?.latest ?? currentVersion
  if (latestVersion === currentVersion) return null
  return {
    pluginName,
    currentVersion,
    latestVersion,
    changelog: data?.changelog ?? data?.notes,
    downloadUrl: data?.downloadUrl ?? data?.tarball,
    channel: data?.channel,
  }
}

export async function applyUpdate(pluginName: string, updateInfo: PluginUpdateInfo): Promise<boolean> {
  if (!updateInfo.downloadUrl) throw new Error(`Missing download URL for ${pluginName}`)
  const response = await fetch(updateInfo.downloadUrl)
  if (!response.ok) throw new Error(`Failed to download update for ${pluginName}`)

  const tempDir = path.join(process.cwd(), '.pakalon', 'plugin-updates', pluginName)
  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(path.join(tempDir, 'update.bin'), Buffer.from(await response.arrayBuffer()))
  return true
}

export function scheduleAutoupdate(plugin: { name: string }, interval: number | PluginAutoupdateConfig): void {
  const intervalMs = typeof interval === 'number' ? interval : interval.intervalMs ?? 24 * 60 * 60 * 1000
  const handle = setInterval(() => {
    void plugin.name
  }, intervalMs)
  scheduledUpdates.set(plugin.name, handle)
}

export function cancelAutoupdate(pluginName: string): boolean {
  const handle = scheduledUpdates.get(pluginName)
  if (!handle) return false
  clearInterval(handle)
  scheduledUpdates.delete(pluginName)
  return true
}
