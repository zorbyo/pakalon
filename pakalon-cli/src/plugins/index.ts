/**
 * Plugin System
 *
 * Complete plugin system for pakalon-cli based on claude_source_code patterns.
 *
 * Supports:
 * - Custom agents (src/plugins/pluginAgents.ts)
 * - Custom tools (PluginManager.registerTool)
 * - Custom commands (src/plugins/loadPlugins.ts)
 * - Custom hooks (src/plugins/pluginPolicy.ts)
 * - Plugin caching (src/plugins/pluginCache.ts)
 *
 * @example
 * import { pluginManager, loadPluginAgents, isPluginBlockedByPolicy } from '@/plugins'
 */

import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import logger from '@/utils/logger.js'

export type { PluginStatus, PluginManifest, Plugin, PluginHook, PluginTool, PluginCommand, PluginComponent, PluginError, PluginLoadResult, AgentDefinition, AgentMemoryScope, PluginSource, CommandMetadata, PluginAuthor, UserConfigOption, DependencyRef } from './types.js'
export { getPluginErrorMessage } from './types.js'

export { loadPluginAgents, clearPluginAgentCache, getPluginAgentByType, getAllPluginAgents } from './pluginAgents.js'
export { loadPlugin, loadAllPlugins, loadAllPluginsCacheOnly, clearPluginCache, loadPluginManifest, createPluginFromDirectory, loadPluginsFromDirectory, discoverPlugins, BUILTIN_MARKETPLACE_NAME } from './loadPlugins.js'
export { pluginPolicyManager, isPluginBlockedByPolicy, isSourceAllowedByPolicy, isMarketplaceAllowed, filterPluginsByPolicy, checkPluginPolicy } from './pluginPolicy.js'
export { pluginCacheManager, getPluginCachePath, getVersionedCachePath, invalidatePluginCache, clearAllPluginCache, getGlobExclusionsForPluginCache, clearPluginCacheExclusions, cleanupOrphanedPlugins, markPluginAsOrphaned } from './pluginCache.js'
export { parsePluginIdentifier, formatPluginId, isValidPluginId, substitutePluginVariables, substituteUserConfigInContent, isLocalPluginSource, isBuiltinPluginId, sanitizePluginName, getPluginsDirectory, getPluginCacheDirectory } from './pluginUtils.js'
export { validatePluginManifest, validatePluginPath, createMinimalManifest, mergePluginManifests, PluginValidator, defaultPluginValidator } from './pluginValidation.js'
export { walkPluginMarkdown, findMarkdownFiles, countMarkdownFiles } from './walkPluginMarkdown.js'

const PLUGIN_DIRS = [
  '.pakalon/plugins',
  path.join(process.env.HOME || '', '.pakalon', 'plugins'),
]

const BUNDLED_PLUGINS_DIR = path.join(__dirname, 'bundled')

class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map()
  private hooks: Map<string, PluginHook[]> = new Map()
  private tools: Map<string, PluginTool> = new Map()
  private commands: Map<string, PluginCommand> = new Map()
  private pluginInstances: Map<string, unknown> = new Map()

  async loadPlugin(pluginPath: string): Promise<Plugin | null> {
    const manifestPath = path.join(pluginPath, 'pakalon.json')

    if (!fs.existsSync(manifestPath)) {
      logger.warn(`Plugin manifest not found: ${manifestPath}`)
      return null
    }

    try {
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
      const manifest: PluginManifest = JSON.parse(manifestContent)

      const pluginId = manifest.name

      if (this.plugins.has(pluginId)) {
        logger.info(`Plugin already loaded: ${pluginId}`)
        return this.plugins.get(pluginId)!
      }

      const plugin: Plugin = {
        id: pluginId,
        manifest,
        path: pluginPath,
        source: pluginId,
        repository: pluginId,
        status: 'loading',
      }

      this.plugins.set(pluginId, plugin)
      this.emit('pluginLoading', plugin)

      if (manifest.main) {
        const mainPath = path.join(pluginPath, manifest.main)

        if (fs.existsSync(mainPath)) {
          const pluginModule = await import(mainPath)

          if (pluginModule.default) {
            this.pluginInstances.set(pluginId, pluginModule.default)
            plugin.instance = pluginModule.default

            if (typeof pluginModule.default.setup === 'function') {
              await pluginModule.default.setup(this)
            }

            if (typeof pluginModule.default.registerHooks === 'function') {
              const pluginHooks = pluginModule.default.registerHooks()
              this.registerPluginHooks(pluginId, pluginHooks)
            }

            if (typeof pluginModule.default.registerTools === 'function') {
              const pluginTools = pluginModule.default.registerTools()
              this.registerPluginTools(pluginId, pluginTools)
            }

            if (typeof pluginModule.default.registerCommands === 'function') {
              const pluginCommands = pluginModule.default.registerCommands()
              this.registerPluginCommands(pluginId, pluginCommands)
            }
          }
        }
      }

      plugin.status = 'loaded'
      this.emit('pluginLoaded', plugin)

      logger.info(`Plugin loaded: ${pluginId} v${manifest.version || '0.0.0'}`)

      return plugin
    } catch (err) {
      logger.error(`Failed to load plugin from ${pluginPath}:`, err)
      const errorPlugin = this.plugins.get(pluginPath) || {
        id: pluginPath,
        manifest: { name: pluginPath, version: '0.0.0', main: '' },
        path: pluginPath,
        source: pluginPath,
        repository: pluginPath,
        status: 'error' as PluginStatus,
        error: String(err),
      }
      errorPlugin.status = 'error'
      errorPlugin.error = String(err)
      this.emit('pluginError', errorPlugin)
      return null
    }
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      return false
    }

    const instance = this.pluginInstances.get(pluginId)
    if (instance && typeof (instance as { cleanup?: () => void }).cleanup === 'function') {
      ;(instance as { cleanup: () => void }).cleanup()
    }

    this.unregisterPluginHooks(pluginId)
    this.unregisterPluginTools(pluginId)
    this.unregisterPluginCommands(pluginId)

    this.pluginInstances.delete(pluginId)
    this.plugins.delete(pluginId)

    this.emit('pluginUnloaded', plugin)

    logger.info(`Plugin unloaded: ${pluginId}`)

    return true
  }

  async enablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      return false
    }

    if (plugin.status === 'disabled') {
      plugin.status = 'loaded'
      plugin.enabled = true
      this.emit('pluginEnabled', plugin)
    }

    return true
  }

  async disablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) {
      return false
    }

    plugin.status = 'disabled'
    plugin.enabled = false
    this.emit('pluginDisabled', plugin)

    return true
  }

  registerHook(name: string, handler: (context: unknown) => Promise<unknown> | unknown, priority = 0): void {
    const hook: PluginHook = { name, handler, priority }

    if (!this.hooks.has(name)) {
      this.hooks.set(name, [])
    }

    const hooks = this.hooks.get(name)!
    hooks.push(hook)
    hooks.sort((a, b) => (b.priority || 0) - (a.priority || 0))
  }

  registerPluginHooks(
    pluginId: string,
    pluginHooks: Array<{ name: string; handler: (context: unknown) => Promise<unknown> | unknown; priority?: number }>,
  ): void {
    for (const hook of pluginHooks) {
      this.registerHook(hook.name, hook.handler, hook.priority)
      logger.debug(`Registered hook ${hook.name} from plugin ${pluginId}`)
    }
  }

  unregisterPluginHooks(pluginId: string): void {
    for (const [name, hooks] of this.hooks.entries()) {
      const remaining = hooks.filter(h => !(h as unknown as { pluginId?: string }).pluginId || (h as unknown as { pluginId: string }).pluginId !== pluginId)
      if (remaining.length === 0) {
        this.hooks.delete(name)
      } else {
        this.hooks.set(name, remaining)
      }
    }
  }

  async executeHook<T>(name: string, context?: T): Promise<unknown[]> {
    const hooks = this.hooks.get(name) || []
    const results: unknown[] = []

    for (const hook of hooks) {
      const plugin = this.getPluginStatus(hook as unknown as { pluginId?: string })
      if (plugin?.status === 'disabled') {
        continue
      }

      try {
        const result = await hook.handler(context)
        results.push(result)
      } catch (err) {
        logger.warn(`Hook ${name} failed:`, err)
        results.push({ error: String(err) })
      }
    }

    return results
  }

  registerTool(tool: PluginTool): void {
    this.tools.set(tool.name, tool)
    this.emit('toolRegistered', tool)
    logger.debug(`Registered tool ${tool.name}`)
  }

  registerPluginTools(pluginId: string, pluginTools: PluginTool[]): void {
    for (const tool of pluginTools) {
      const toolWithId = { ...tool, pluginId }
      this.tools.set(tool.name, toolWithId)
      this.emit('toolRegistered', toolWithId)
      logger.debug(`Registered tool ${tool.name} from plugin ${pluginId}`)
    }
  }

  unregisterPluginTools(pluginId: string): void {
    const toolsToRemove: string[] = []

    for (const [name, tool] of this.tools.entries()) {
      if ((tool as unknown as { pluginId?: string }).pluginId === pluginId) {
        toolsToRemove.push(name)
      }
    }

    for (const name of toolsToRemove) {
      this.tools.delete(name)
      this.emit('toolUnregistered', name)
    }
  }

  getTool(name: string): PluginTool | undefined {
    return this.tools.get(name)
  }

  getAllTools(): PluginTool[] {
    return Array.from(this.tools.values())
  }

  registerCommand(command: PluginCommand): void {
    this.commands.set(command.name, command)
    this.emit('commandRegistered', command)
    logger.debug(`Registered command ${command.name}`)
  }

  registerPluginCommands(pluginId: string, pluginCommands: PluginCommand[]): void {
    for (const command of pluginCommands) {
      const commandWithId = { ...command, pluginId }
      this.commands.set(command.name, commandWithId)
      this.emit('commandRegistered', commandWithId)
      logger.debug(`Registered command ${command.name} from plugin ${pluginId}`)
    }
  }

  unregisterPluginCommands(pluginId: string): void {
    const commandsToRemove: string[] = []

    for (const [name, command] of this.commands.entries()) {
      if ((command as unknown as { pluginId?: string }).pluginId === pluginId) {
        commandsToRemove.push(name)
      }
    }

    for (const name of commandsToRemove) {
      this.commands.delete(name)
      this.emit('commandUnregistered', name)
    }
  }

  getCommand(name: string): PluginCommand | undefined {
    return this.commands.get(name)
  }

  getAllCommands(): PluginCommand[] {
    return Array.from(this.commands.values())
  }

  async executeCommand(name: string, args: unknown): Promise<unknown> {
    const command = this.commands.get(name)
    if (!command) {
      throw new Error(`Command not found: ${name}`)
    }

    return command.handler(args)
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId)
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  getPluginsByStatus(status: PluginStatus): Plugin[] {
    return this.getAllPlugins().filter(p => p.status === status)
  }

  getPluginStatus(hook: { pluginId?: string }): Plugin | undefined {
    if (!hook.pluginId) {
      return undefined
    }
    return this.plugins.get(hook.pluginId)
  }

  async loadAllPlugins(): Promise<void> {
    for (const dir of PLUGIN_DIRS) {
      await this.loadPluginsFromDirectory(dir)
    }

    if (fs.existsSync(BUNDLED_PLUGINS_DIR)) {
      await this.loadPluginsFromDirectory(BUNDLED_PLUGINS_DIR)
    }
  }

  private async loadPluginsFromDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(dirPath, entry.name)
          await this.loadPlugin(pluginPath)
        }
      }
    } catch (err) {
      logger.warn(`Failed to load plugins from ${dirPath}:`, err)
    }
  }

  async reloadAllPlugins(): Promise<void> {
    const pluginIds = Array.from(this.plugins.keys())

    for (const id of pluginIds) {
      await this.unloadPlugin(id)
    }

    await this.loadAllPlugins()
  }
}

export const pluginManager = new PluginManager()

export async function initializePlugins(): Promise<void> {
  await pluginManager.loadAllPlugins()
  pluginManager.on('pluginLoaded', plugin => {
    logger.info(`Plugin initialized: ${plugin.manifest.name}`)
  })

  pluginManager.on('pluginError', plugin => {
    logger.error(`Plugin error: ${plugin.manifest.name} - ${plugin.error}`)
  })
}

export function getPluginManager(): PluginManager {
  return pluginManager
}

export type { PluginManager }