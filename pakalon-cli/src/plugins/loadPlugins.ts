/**
 * Plugin Loading Module
 *
 * Handles plugin discovery, loading, validation, and initialization.
 * Supports multiple plugin sources: local paths, npm, git, GitHub.
 *
 * Plugin Directory Structure:
 * ```
 * my-plugin/
 * ├── pakalon.json       # Optional manifest with metadata
 * ├── commands/          # Custom slash commands
 * │   ├── build.md
 * │   └── deploy.md
 * ├── agents/            # Custom AI agents
 * │   └── test-runner.md
 * └── hooks/             # Hook configurations
 *     └── hooks.json     # Hook definitions
 * ```
 */

import fs from 'fs/promises'
import path from 'path'
import memoize from 'lodash-es/memoize.js'
import { pathExists } from '../utils/file.js'
import { getFsImplementation } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'
import {
  parsePluginIdentifier,
  getVersionedCachePath,
  getPluginCachePath,
  generateTemporaryCacheNameForPlugin,
} from './pluginUtils.js'
import {
  type Plugin,
  type PluginManifest,
  type PluginSource,
  type PluginLoadResult,
  type PluginError,
  getPluginErrorMessage,
} from './types.js'
import { validatePluginManifest, createPluginFromPath } from './pluginValidation.js'

const PLUGIN_DIRS = [
  path.join(process.cwd(), '.pakalon', 'plugins'),
  path.join(process.env.HOME || '', '.pakalon', 'plugins'),
]

export const BUILTIN_MARKETPLACE_NAME = 'builtin'

function getPluginCacheDir(): string {
  return getPluginCachePath()
}

function getEnabledPlugins(): Record<string, boolean> {
  try {
    const settingsPath = path.join(process.cwd(), '.pakalon', 'settings.json')
    if (require('fs').existsSync(settingsPath)) {
      const settings = JSON.parse(require('fs').readFileSync(settingsPath, 'utf-8'))
      return settings.enabledPlugins || {}
    }
  } catch {}
  return {}
}

export async function cachePlugin(
  source: PluginSource,
  options?: { manifest?: PluginManifest },
): Promise<{ path: string; manifest: PluginManifest }> {
  const cacheDir = getPluginCacheDir()
  await getFsImplementation().mkdir(cacheDir, { recursive: true })

  const tempName = generateTemporaryCacheNameForPlugin(source)
  const tempPath = path.join(cacheDir, tempName)

  await installPluginSource(source, tempPath)

  const manifestPath = path.join(tempPath, 'pakalon.json')
  let manifest: PluginManifest

  if (await pathExists(manifestPath)) {
    const content = await fs.readFile(manifestPath, 'utf-8')
    manifest = JSON.parse(content)
  } else {
    manifest = options?.manifest || { name: tempName }
  }

  const finalName = manifest.name.replace(/[^a-zA-Z0-9-_]/g, '-')
  const finalPath = path.join(cacheDir, finalName)

  if (await pathExists(finalPath)) {
    await fs.rm(finalPath, { recursive: true, force: true })
  }

  await fs.rename(tempPath, finalPath)

  return { path: finalPath, manifest }
}

async function installPluginSource(source: PluginSource, targetPath: string): Promise<void> {
  const fsImpl = getFsImplementation()

  if (typeof source === 'string') {
    const sourcePath = source.startsWith('./') ? path.resolve(source) : source
    if (!(await pathExists(sourcePath))) {
      throw new Error(`Plugin source path not found: ${sourcePath}`)
    }
    await copyDir(sourcePath, targetPath)
    return
  }

  switch (source.source) {
    case 'npm': {
      const { execFileNoThrow } = await import('../utils/execFileNoThrow.js')
      const npmCachePath = path.join(getPluginCacheDir(), 'npm-cache')
      await fsImpl.mkdir(npmCachePath, { recursive: true })

      const packageSpec = source.version ? `${source.package}@${source.version}` : source.package!
      const packagePath = path.join(npmCachePath, 'node_modules', source.package!)

      if (!(await pathExists(packagePath))) {
        const args = ['install', packageSpec, '--prefix', npmCachePath]
        if (source.registry) {
          args.push('--registry', source.registry)
        }
        const result = await execFileNoThrow('npm', args)
        if (result.code !== 0) {
          throw new Error(`Failed to install npm package: ${result.stderr}`)
        }
      }

      await copyDir(packagePath, targetPath)
      break
    }

    case 'github': {
      const { execFileNoThrow } = await import('../utils/execFileNoThrow.js')
      const gitUrl = `https://github.com/${source.repo}.git`
      const args = ['clone', '--depth', '1']

      if (source.ref) {
        args.push('--branch', source.ref)
      }

      args.push(gitUrl, targetPath)

      const result = await execFileNoThrow('git', args)
      if (result.code !== 0) {
        throw new Error(`Failed to clone repository: ${result.stderr}`)
      }
      break
    }

    case 'url': {
      const { execFileNoThrow } = await import('../utils/execFileNoThrow.js')
      const result = await execFileNoThrow('git', ['clone', '--depth', '1', source.url!, targetPath])
      if (result.code !== 0) {
        throw new Error(`Failed to clone repository: ${result.stderr}`)
      }
      break
    }

    default:
      throw new Error(`Unsupported plugin source type: ${source.source}`)
  }

  const gitPath = path.join(targetPath, '.git')
  await fs.rm(gitPath, { recursive: true, force: true }).catch(() => {})
}

async function copyDir(src: string, dest: string): Promise<void> {
  await getFsImplementation().mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

export async function loadPluginManifest(manifestPath: string): Promise<PluginManifest | null> {
  if (!(await pathExists(manifestPath))) {
    return null
  }

  try {
    const content = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(content)
    return validatePluginManifest(parsed)
  } catch (error) {
    logForDebugging(`Failed to parse plugin manifest at ${manifestPath}: ${error}`)
    return null
  }
}

export async function createPluginFromDirectory(
  pluginPath: string,
  source: string,
  enabled: boolean = true,
): Promise<{ plugin: Plugin; errors: PluginError[] }> {
  const errors: PluginError[] = []
  const manifestPath = path.join(pluginPath, 'pakalon.json')

  let manifest: PluginManifest | null = null

  try {
    manifest = await loadPluginManifest(manifestPath)
  } catch (error) {
    errors.push({
      type: 'manifest-parse-error',
      source,
      manifestPath,
      parseError: String(error),
    })
  }

  if (!manifest) {
    const fallbackName = path.basename(pluginPath)
    manifest = {
      name: fallbackName,
      description: `Plugin from ${source}`,
    }
  }

  const plugin: Plugin = {
    id: `${manifest.name}@${source}`,
    manifest,
    path: pluginPath,
    source,
    repository: source,
    status: 'loaded',
    enabled,
  }

  if (await pathExists(path.join(pluginPath, 'commands'))) {
    plugin.commandsPath = path.join(pluginPath, 'commands')
  }

  if (await pathExists(path.join(pluginPath, 'agents'))) {
    plugin.agentsPath = path.join(pluginPath, 'agents')
  }

  if (await pathExists(path.join(pluginPath, 'skills'))) {
    plugin.skillsPath = path.join(pluginPath, 'skills')
  }

  if (await pathExists(path.join(pluginPath, 'hooks', 'hooks.json'))) {
    try {
      const hooksContent = await fs.readFile(path.join(pluginPath, 'hooks', 'hooks.json'), 'utf-8')
      plugin.hooksConfig = JSON.parse(hooksContent)
    } catch (error) {
      errors.push({
        type: 'hook-load-failed',
        source,
        plugin: manifest.name,
        hookPath: path.join(pluginPath, 'hooks', 'hooks.json'),
        reason: String(error),
      })
    }
  }

  return { plugin, errors }
}

export async function loadPlugin(
  pluginId: string,
  options?: { enabled?: boolean; version?: string },
): Promise<{ plugin: Plugin | null; errors: PluginError[] }> {
  const errors: PluginError[] = []
  const { name: pluginName, marketplace } = parsePluginIdentifier(pluginId)

  if (marketplace === BUILTIN_MARKETPLACE_NAME) {
    return { plugin: null, errors: [{ type: 'plugin-not-found', source: pluginId, pluginId, marketplace }] }
  }

  let pluginPath: string

  if (marketplace) {
    const versionedPath = getVersionedCachePath(pluginId, options?.version || 'latest')
    if (await pathExists(versionedPath)) {
      pluginPath = versionedPath
    } else {
      const cacheDir = getPluginCacheDir()
      pluginPath = path.join(cacheDir, pluginName)
    }
  } else {
    pluginPath = path.join(getPluginCacheDir(), pluginName)
  }

  if (!(await pathExists(pluginPath))) {
    errors.push({
      type: 'plugin-cache-miss',
      source: pluginId,
      plugin: pluginName,
      installPath: pluginPath,
    })
    return { plugin: null, errors }
  }

  return createPluginFromDirectory(pluginPath, pluginId, options?.enabled ?? true)
}

export const loadAllPlugins = memoize(
  async (cacheOnly: boolean = false): Promise<PluginLoadResult> => {
    const enabledPlugins: Plugin[] = []
    const disabledPlugins: Plugin[] = []
    const errors: PluginError[] = []

    const enabledSettings = getEnabledPlugins()

    for (const [pluginId, isEnabled] of Object.entries(enabledSettings)) {
      const { plugin, errors: loadErrors } = await loadPlugin(pluginId, { enabled: isEnabled })

      if (loadErrors.length > 0) {
        errors.push(...loadErrors)
      }

      if (plugin) {
        if (isEnabled) {
          enabledPlugins.push(plugin)
        } else {
          disabledPlugins.push(plugin)
        }
      }
    }

    logForDebugging(`Loaded ${enabledPlugins.length} enabled plugins, ${disabledPlugins.length} disabled plugins`)

    return { enabled: enabledPlugins, disabled: disabledPlugins, errors }
  },
)

export async function loadAllPluginsCacheOnly(): Promise<{ enabled: Plugin[]; errors: PluginError[] }> {
  const result = await loadAllPlugins(true)
  return { enabled: result.enabled, errors: result.errors }
}

export function clearPluginCache(): void {
  loadAllPlugins.cache?.clear?.()
}

export async function loadPluginsFromDirectory(dirPath: string): Promise<Plugin[]> {
  const plugins: Plugin[] = []

  if (!(await pathExists(dirPath))) {
    return plugins
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(dirPath, entry.name)
        const { plugin } = await createPluginFromDirectory(pluginPath, entry.name)
        plugins.push(plugin)
      }
    }
  } catch (error) {
    logForDebugging(`Failed to load plugins from directory ${dirPath}: ${error}`)
  }

  return plugins
}

export async function discoverPlugins(): Promise<string[]> {
  const discovered: string[] = []

  for (const dir of PLUGIN_DIRS) {
    if (await pathExists(dir)) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            discovered.push(path.join(dir, entry.name))
          }
        }
      } catch {}
    }
  }

  return discovered
}