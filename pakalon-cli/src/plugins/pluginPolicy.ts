/**
 * Plugin Policy Module
 *
 * Provides policy enforcement for plugins including:
 * - Blocked plugins list (enterprise-managed)
 * - Allowed marketplace sources
 * - Plugin enable/disable policies
 *
 * Policy checks are backed by settings (policySettings) and provide
 * a single source of truth for policy blocking across install,
 * enable operations, and UI filters.
 */

import { logForDebugging } from '../utils/debug.js'

interface PolicySettings {
  enabledPlugins?: Record<string, boolean>
  blockedPlugins?: string[]
  allowedSources?: string[]
  blockedMarketplaces?: string[]
  strictKnownMarketplaces?: string[] | null
}

function getPolicySettings(): PolicySettings | null {
  try {
    const settingsPath = `${process.cwd()}/.pakalon/settings.json`
    if (require('fs').existsSync(settingsPath)) {
      const settings = JSON.parse(require('fs').readFileSync(settingsPath, 'utf-8'))
      return settings.policySettings || null
    }
  } catch {}
  return null
}

export function isPluginBlockedByPolicy(pluginId: string): boolean {
  const policySettings = getPolicySettings()

  if (policySettings?.blockedPlugins?.includes(pluginId)) {
    return true
  }

  if (policySettings?.enabledPlugins?.[pluginId] === false) {
    return true
  }

  return false
}

export function isSourceAllowedByPolicy(source: string): boolean {
  const policySettings = getPolicySettings()

  if (!policySettings) {
    return true
  }

  if (policySettings.allowedSources && policySettings.allowedSources.length > 0) {
    return policySettings.allowedSources.some(allowed => {
      if (allowed.startsWith('github:')) {
        return source.includes(allowed.replace('github:', ''))
      }
      if (allowed.startsWith('npm:')) {
        return source.includes(allowed.replace('npm:', ''))
      }
      return source.includes(allowed)
    })
  }

  if (policySettings.blockedMarketplaces && policySettings.blockedMarketplaces.length > 0) {
    return !policySettings.blockedMarketplaces.some(blocked => source.includes(blocked))
  }

  return true
}

export function isMarketplaceAllowed(marketplaceName: string): boolean {
  const policySettings = getPolicySettings()

  if (!policySettings) {
    return true
  }

  if (policySettings.blockedMarketplaces?.includes(marketplaceName)) {
    return false
  }

  if (policySettings.strictKnownMarketplaces !== null && policySettings.strictKnownMarketplaces !== undefined) {
    return policySettings.strictKnownMarketplaces.includes(marketplaceName)
  }

  return true
}

export function filterPluginsByPolicy<T extends { id?: string; source?: string }>(
  plugins: T[],
): { allowed: T[]; blocked: T[] } {
  const allowed: T[] = []
  const blocked: T[] = []

  for (const plugin of plugins) {
    const pluginId = plugin.id || plugin.source || ''
    if (isPluginBlockedByPolicy(pluginId)) {
      blocked.push(plugin)
    } else {
      allowed.push(plugin)
    }
  }

  return { allowed, blocked }
}

export function getAllowedPluginIds(): string[] {
  const policySettings = getPolicySettings()

  if (!policySettings) {
    return []
  }

  if (policySettings.allowedSources) {
    return []
  }

  return []
}

export function getBlockedPluginIds(): string[] {
  const policySettings = getPolicySettings()

  if (!policySettings) {
    return []
  }

  return policySettings.blockedPlugins || []
}

export function checkPluginPolicy(pluginId: string): { allowed: boolean; reason?: string } {
  if (isPluginBlockedByPolicy(pluginId)) {
    return { allowed: false, reason: `Plugin ${pluginId} is blocked by enterprise policy` }
  }

  const { marketplace } = parsePluginIdentifier(pluginId)
  if (marketplace && !isMarketplaceAllowed(marketplace)) {
    return { allowed: false, reason: `Marketplace '${marketplace}' is not in the allowed marketplace list` }
  }

  return { allowed: true }
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

export class PluginPolicyManager {
  private cachedPolicy: PolicySettings | null = null
  private policyCacheTime: number = 0
  private readonly CACHE_TTL = 5000

  private loadPolicy(): PolicySettings {
    const now = Date.now()
    if (this.cachedPolicy && now - this.policyCacheTime < this.CACHE_TTL) {
      return this.cachedPolicy
    }

    this.cachedPolicy = getPolicySettings()
    this.policyCacheTime = now
    return this.cachedPolicy || {}
  }

  isPluginBlocked(pluginId: string): boolean {
    const policy = this.loadPolicy()

    if (policy.blockedPlugins?.includes(pluginId)) {
      return true
    }

    if (policy.enabledPlugins?.[pluginId] === false) {
      return true
    }

    return false
  }

  canEnablePlugin(pluginId: string): { allowed: boolean; reason?: string } {
    const policy = this.loadPolicy()

    if (policy.blockedPlugins?.includes(pluginId)) {
      return { allowed: false, reason: `Plugin ${pluginId} is blocked and cannot be enabled` }
    }

    return { allowed: true }
  }

  canInstallFromSource(source: string): { allowed: boolean; reason?: string } {
    const policy = this.loadPolicy()

    if (policy.allowedSources && policy.allowedSources.length > 0) {
      const isAllowed = policy.allowedSources.some(allowed => {
        if (allowed.startsWith('github:')) {
          return source.includes(allowed.replace('github:', ''))
        }
        if (allowed.startsWith('npm:')) {
          return source.includes(allowed.replace('npm:', ''))
        }
        return source.includes(allowed)
      })

      if (!isAllowed) {
        return { allowed: false, reason: `Source '${source}' is not in the allowed sources list` }
      }
    }

    if (policy.blockedMarketplaces && policy.blockedMarketplaces.length > 0) {
      const isBlocked = policy.blockedMarketplaces.some(blocked => source.includes(blocked))
      if (isBlocked) {
        return { allowed: false, reason: `Source '${source}' is from a blocked marketplace` }
      }
    }

    return { allowed: true }
  }

  clearCache(): void {
    this.cachedPolicy = null
    this.policyCacheTime = 0
  }
}

export const pluginPolicyManager = new PluginPolicyManager()