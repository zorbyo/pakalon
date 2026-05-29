/**
 * Plugin Cache Module
 *
 * Provides caching functionality for plugins including:
 * - Versioned cache paths
 * - Cache invalidation
 * - Orphaned plugin cleanup
 * - Session-scoped cache management
 */

import fs from 'fs/promises'
import path from 'path'
import { pathExists } from '../utils/file.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'

const PLUGIN_CACHE_DIR = path.join(process.env.HOME || '', '.pakalon', 'plugins', 'cache')
const ORPHANED_AT_FILENAME = '.orphaned_at'

export function getPluginCachePath(): string {
  return PLUGIN_CACHE_DIR
}

export function getVersionedCachePath(pluginId: string, version: string): string {
  const { name: pluginName, marketplace } = parsePluginIdentifier(pluginId)
  const sanitizedMarketplace = (marketplace || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedPlugin = pluginName.replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedVersion = version.replace(/[^a-zA-Z0-9\-_.]/g, '-')

  return path.join(PLUGIN_CACHE_DIR, sanitizedMarketplace, sanitizedPlugin, sanitizedVersion)
}

export function getLegacyCachePath(pluginName: string): string {
  return path.join(PLUGIN_CACHE_DIR, pluginName.replace(/[^a-zA-Z0-9\-_]/g, '-'))
}

export function generateTemporaryCacheNameForPlugin(source: { source: string } | string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)

  let prefix: string
  if (typeof source === 'string') {
    prefix = 'local'
  } else {
    switch (source.source) {
      case 'npm':
        prefix = 'npm'
        break
      case 'github':
        prefix = 'github'
        break
      case 'url':
        prefix = 'git'
        break
      case 'git-subdir':
        prefix = 'subdir'
        break
      default:
        prefix = 'unknown'
    }
  }

  return `temp_${prefix}_${timestamp}_${random}`
}

function parsePluginIdentifier(pluginId: string): { name: string; marketplace: string | undefined } {
  const atIndex = pluginId.lastIndexOf('@')
  if (atIndex === -1) {
    return { name: pluginId, marketplace: undefined }
  }
  return {
    name: pluginId.substring(0, atIndex),
    marketplace: pluginId.substring(atIndex + 1),
  }
}

export async function resolvePluginPath(
  pluginId: string,
  version?: string,
): Promise<string> {
  if (version) {
    const versionedPath = getVersionedCachePath(pluginId, version)
    if (await pathExists(versionedPath)) {
      return versionedPath
    }
  }

  const pluginName = parsePluginIdentifier(pluginId).name || pluginId
  const legacyPath = getLegacyCachePath(pluginName)
  if (await pathExists(legacyPath)) {
    return legacyPath
  }

  return version ? getVersionedCachePath(pluginId, version) : legacyPath
}

export async function isPluginCached(pluginId: string, version?: string): Promise<boolean> {
  const cachePath = await resolvePluginPath(pluginId, version)
  return pathExists(cachePath)
}

export async function invalidatePluginCache(pluginId: string): Promise<void> {
  try {
    const cachePath = await resolvePluginPath(pluginId)
    if (await pathExists(cachePath)) {
      await fs.rm(cachePath, { recursive: true, force: true })
      logForDebugging(`Invalidated cache for plugin ${pluginId} at ${cachePath}`)
    }
  } catch (error) {
    logForDebugging(`Failed to invalidate cache for plugin ${pluginId}: ${error}`)
  }
}

export async function clearAllPluginCache(): Promise<void> {
  try {
    if (await pathExists(PLUGIN_CACHE_DIR)) {
      const entries = await fs.readdir(PLUGIN_CACHE_DIR, { withFileTypes: true })
      await Promise.all(
        entries.map(async entry => {
          const fullPath = path.join(PLUGIN_CACHE_DIR, entry.name)
          await fs.rm(fullPath, { recursive: true, force: true })
        }),
      )
      logForDebugging(`Cleared all plugin cache at ${PLUGIN_CACHE_DIR}`)
    }
  } catch (error) {
    logForDebugging(`Failed to clear plugin cache: ${error}`)
  }
}

let cachedExclusions: string[] | null = null

export async function getGlobExclusionsForPluginCache(searchPath?: string): Promise<string[]> {
  if (searchPath) {
    const normalizedSearch = path.normalize(searchPath)
    const normalizedCache = path.normalize(PLUGIN_CACHE_DIR)
    if (!normalizedSearch.startsWith(normalizedCache)) {
      return []
    }
  }

  if (cachedExclusions !== null) {
    return cachedExclusions
  }

  try {
    const markers = await findOrphanedMarkers()
    cachedExclusions = markers.map(markerPath => {
      const versionDir = path.dirname(markerPath)
      const rel = path.relative(PLUGIN_CACHE_DIR, versionDir)
      const posixRelative = rel.replace(/\\/g, '/')
      return `!**/${posixRelative}/**`
    })
    return cachedExclusions
  } catch {
    cachedExclusions = []
    return cachedExclusions
  }
}

async function findOrphanedMarkers(): Promise<string[]> {
  const markers: string[] = []

  async function searchDir(dir: string, depth: number): Promise<void> {
    if (depth > 4) return

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.name === ORPHANED_AT_FILENAME) {
          markers.push(fullPath)
        } else if (entry.isDirectory()) {
          await searchDir(fullPath, depth + 1)
        }
      }
    } catch {}
  }

  if (await pathExists(PLUGIN_CACHE_DIR)) {
    await searchDir(PLUGIN_CACHE_DIR, 0)
  }

  return markers
}

export function clearPluginCacheExclusions(): void {
  cachedExclusions = null
}

export async function markPluginAsOrphaned(pluginPath: string): Promise<void> {
  const orphanedMarker = path.join(pluginPath, ORPHANED_AT_FILENAME)
  const fsImpl = getFsImplementation()

  try {
    await fsImpl.mkdir(pluginPath, { recursive: true })
    await fs.writeFile(orphanedMarker, new Date().toISOString())
    logForDebugging(`Marked plugin as orphaned: ${pluginPath}`)
  } catch (error) {
    logForDebugging(`Failed to mark plugin as orphaned: ${error}`)
  }
}

export async function cleanupOrphanedPlugins(maxAgeDays: number = 7): Promise<string[]> {
  const cleanedUp: string[] = []
  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

  async function checkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          const orphanedMarker = path.join(fullPath, ORPHANED_AT_FILENAME)

          if (await pathExists(orphanedMarker)) {
            try {
              const content = await fs.readFile(orphanedMarker, 'utf-8')
              const orphanedTime = new Date(content.trim()).getTime()

              if (now - orphanedTime > maxAgeMs) {
                await fs.rm(fullPath, { recursive: true, force: true })
                cleanedUp.push(fullPath)
                logForDebugging(`Cleaned up orphaned plugin: ${fullPath}`)
              }
            } catch {}
          } else {
            await checkDir(fullPath)
          }
        }
      }
    } catch {}
  }

  if (await pathExists(PLUGIN_CACHE_DIR)) {
    await checkDir(PLUGIN_CACHE_DIR)
  }

  return cleanedUp
}

export class PluginCacheManager {
  private cacheDir: string

  constructor(cacheDir: string = PLUGIN_CACHE_DIR) {
    this.cacheDir = cacheDir
  }

  getCacheDir(): string {
    return this.cacheDir
  }

  async ensureCacheDir(): Promise<void> {
    await getFsImplementation().mkdir(this.cacheDir, { recursive: true })
  }

  async getCachedVersion(pluginId: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(path.join(this.cacheDir, parsePluginIdentifier(pluginId).name), {
        withFileTypes: true,
      })

      const versions = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
        .reverse()

      return versions[0] || null
    } catch {
      return null
    }
  }

  async isVersionCached(pluginId: string, version: string): Promise<boolean> {
    const versionPath = getVersionedCachePath(pluginId, version)
    return pathExists(versionPath)
  }

  async clearPlugin(pluginId: string): Promise<void> {
    const pluginName = parsePluginIdentifier(pluginId).name
    const pluginDir = path.join(this.cacheDir, pluginName)

    if (await pathExists(pluginDir)) {
      await fs.rm(pluginDir, { recursive: true, force: true })
    }
  }

  async getCacheStats(): Promise<{
    totalPlugins: number
    totalSize: number
    oldestPlugin?: string
    newestPlugin?: string
  }> {
    let totalPlugins = 0
    let totalSize = 0
    let oldestPlugin: string | undefined
    let newestPlugin: string | undefined
    let oldestTime = Infinity
    let newestTime = -Infinity

    async function calculateSize(dir: string): Promise<number> {
      let size = 0
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            size += await calculateSize(fullPath)
          } else {
            const stats = await fs.stat(fullPath)
            size += stats.size
          }
        }
      } catch {}
      return size
    }

    try {
      const entries = await fs.readdir(this.cacheDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          totalPlugins++
          const pluginDir = path.join(this.cacheDir, entry.name)

          try {
            const stats = await fs.stat(pluginDir)
            const mtime = stats.mtimeMs

            if (mtime < oldestTime) {
              oldestTime = mtime
              oldestPlugin = entry.name
            }
            if (mtime > newestTime) {
              newestTime = mtime
              newestPlugin = entry.name
            }
          } catch {}

          totalSize += await calculateSize(pluginDir)
        }
      }
    } catch {}

    return {
      totalPlugins,
      totalSize,
      oldestPlugin,
      newestPlugin,
    }
  }
}

export const pluginCacheManager = new PluginCacheManager()