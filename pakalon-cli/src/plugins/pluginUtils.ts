/**
 * Plugin Utilities
 *
 * Shared utility functions for plugin system including:
 * - Plugin identifier parsing
 * - Variable substitution
 * - Path utilities
 */

import path from 'path'

export function parsePluginIdentifier(pluginId: string): { name: string; marketplace: string | undefined } {
  const atIndex = pluginId.lastIndexOf('@')
  if (atIndex === -1) {
    return { name: pluginId, marketplace: undefined }
  }
  return {
    name: pluginId.substring(0, atIndex),
    marketplace: pluginId.substring(atIndex + 1),
  }
}

export function formatPluginId(name: string, marketplace: string): string {
  return `${name}@${marketplace}`
}

export function isValidPluginId(pluginId: string): boolean {
  return /^[a-zA-Z0-9][-a-zA-Z0-9._]*@[a-zA-Z0-9][-a-zA-Z0-9._]*$/i.test(pluginId)
}

export function substitutePluginVariables(
  content: string,
  options: { path?: string; source?: string },
): string {
  let result = content

  if (options.path) {
    result = result.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, options.path)
    result = result.replace(/\$\{CLAUDE_PLUGIN_PATH\}/g, options.path)
  }

  if (options.source) {
    result = result.replace(/\$\{CLAUDE_PLUGIN_SOURCE\}/g, options.source)
  }

  return result
}

export function substituteUserConfigInContent(
  content: string,
  userConfig: Record<string, unknown>,
  userConfigSchema: Record<string, { sensitive?: boolean }>,
): string {
  let result = content

  for (const [key, value] of Object.entries(userConfig)) {
    const configInfo = userConfigSchema[key]
    const placeholder = configInfo?.sensitive ? '<sensitive>' : String(value)
    result = result.replace(new RegExp(`\\$\\{user_config\\.${key}\\}`, 'g'), placeholder)
  }

  return result
}

export function getPluginRoot(pluginPath: string): string {
  const pluginJsonPath = path.join(pluginPath, 'pakalon.json')
  const alternativePath = path.join(pluginPath, '.claude-plugin', 'pakalon.json')

  if (pluginJsonPath.includes('.claude-plugin')) {
    return path.dirname(path.dirname(pluginJsonPath))
  }

  return path.dirname(pluginJsonPath)
}

export function normalizePluginPath(pluginPath: string): string {
  return path.normalize(pluginPath).replace(/\\/g, '/')
}

export function isPluginPath(pathToCheck: string, pluginRoot: string): boolean {
  const normalizedPath = normalizePluginPath(pathToCheck)
  const normalizedRoot = normalizePluginPath(pluginRoot)
  return normalizedPath.startsWith(normalizedRoot)
}

export function getRelativePath(from: string, to: string): string {
  const relative = path.relative(from, to)
  return relative.startsWith('.') ? relative : `./${relative}`
}

export function sanitizePluginName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase()
}

export function sanitizeVersion(version: string): string {
  return version.replace(/[^a-zA-Z0-9-_.]/g, '-')
}

export function getPluginsDirectory(): string {
  return path.join(process.env.HOME || '', '.pakalon', 'plugins')
}

export function getPluginCacheDirectory(): string {
  return path.join(getPluginsDirectory(), 'cache')
}

export function getVersionedCachePathIn(
  baseDir: string,
  pluginId: string,
  version: string,
): string {
  const { name: pluginName, marketplace } = parsePluginIdentifier(pluginId)
  const sanitizedMarketplace = (marketplace || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedPlugin = pluginName.replace(/[^a-zA-Z0-9\-_]/g, '-')
  const sanitizedVersion = sanitizeVersion(version)

  return path.join(baseDir, 'cache', sanitizedMarketplace, sanitizedPlugin, sanitizedVersion)
}

export function getVersionedCachePath(pluginId: string, version: string): string {
  return getVersionedCachePathIn(getPluginsDirectory(), pluginId, version)
}

export function getPluginCachePath(): string {
  return path.join(getPluginsDirectory(), 'cache')
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

export function isLocalPluginSource(source: string | { source: string }): boolean {
  if (typeof source === 'string') {
    return source.startsWith('./')
  }
  return false
}

export function isBuiltinPluginId(pluginId: string): boolean {
  return pluginId.endsWith('@builtin')
}

export function parseAgentToolsFromFrontmatter(tools: unknown): string[] | undefined {
  if (!tools) return undefined
  if (typeof tools === 'string') {
    return tools.split(',').map(t => t.trim()).filter(Boolean)
  }
  if (Array.isArray(tools)) {
    return tools.map(t => String(t).trim()).filter(Boolean)
  }
  return undefined
}

export function parseSlashCommandToolsFromFrontmatter(skills: unknown): string[] | undefined {
  if (!skills) return undefined
  if (typeof skills === 'string') {
    return skills.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (Array.isArray(skills)) {
    return skills.map(s => String(s).trim()).filter(Boolean)
  }
  return undefined
}

export function logPluginInfo(message: string, ...args: unknown[]): void {
  console.log(`[Plugin] ${message}`, ...args)
}

export function logPluginError(message: string, ...args: unknown[]): void {
  console.error(`[Plugin Error] ${message}`, ...args)
}

export function logPluginDebug(message: string, ...args: unknown[]): void {
  if (process.env.DEBUG?.includes('plugin')) {
    console.debug(`[Plugin Debug] ${message}`, ...args)
  }
}