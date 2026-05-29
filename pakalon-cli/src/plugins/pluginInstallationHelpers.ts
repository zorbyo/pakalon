/**
 * Local plugin installation helpers.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { pathExists } from '../utils/file.js'
import { getFsImplementation } from '../utils/fsOperations.js'

export interface PluginInstallOptions {
  overwrite?: boolean
  keepBackup?: boolean
  validateStructure?: boolean
}

async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  await fs.mkdir(dest, { recursive: true })
  for (const entry of entries) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(from, to)
    else if (entry.isFile()) await fs.copyFile(from, to)
  }
}

export async function verifyPluginIntegrity(pluginDir: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = []
  const manifestPath = path.join(pluginDir, 'pakalon.json')
  if (!(await pathExists(manifestPath))) errors.push('Missing pakalon.json')
  if (!(await pathExists(pluginDir))) errors.push('Plugin directory not found')
  return { valid: errors.length === 0, errors }
}

export async function installPluginFromPath(source: string, dest: string, options: PluginInstallOptions = {}): Promise<void> {
  const fsImpl = getFsImplementation()
  if (options.overwrite && (await pathExists(dest))) {
    await fs.rm(dest, { recursive: true, force: true })
  }

  const backup = `${dest}.bak`
  if (await pathExists(dest) && options.keepBackup) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => {})
    await fs.rename(dest, backup)
  }

  try {
    await fsImpl.mkdir(path.dirname(dest), { recursive: true })
    await copyDir(source, dest)
    if (options.validateStructure !== false) {
      const integrity = await verifyPluginIntegrity(dest)
      if (!integrity.valid) throw new Error(integrity.errors.join('; '))
    }
  } catch (error) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
    if (options.keepBackup && await pathExists(backup)) {
      await fs.rename(backup, dest).catch(() => {})
    }
    throw error
  }

  if (options.keepBackup) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => {})
  }
}

export async function installPluginFromUrl(url: string, dest: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to download plugin: ${response.status} ${response.statusText}`)

  const tempDir = `${dest}.download`
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(tempDir, { recursive: true })
  const buffer = Buffer.from(await response.arrayBuffer())
  const filePath = path.join(tempDir, 'plugin.tgz')
  await fs.writeFile(filePath, buffer)
  throw new Error('URL installation requires archive extraction support in the caller')
}

export async function uninstallPlugin(pluginName: string, pluginDir: string): Promise<boolean> {
  const target = path.join(pluginDir, pluginName)
  if (!(await pathExists(target))) return false
  await fs.rm(target, { recursive: true, force: true })
  return true
}
