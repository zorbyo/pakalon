/**
 * Settings Types and Utilities
 *
 * Provides types and utilities for settings management.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { SettingSource, EditableSettingSource } from './constants.js'

export interface SettingsJson {
  model?: string
  theme?: string
  permissionMode?: string
  maxTurns?: number
  temperature?: number
  thinkingEnabled?: boolean
  fastMode?: boolean
  autoAccept?: boolean
  language?: string
  voiceEnabled?: boolean
  env?: Record<string, string>
  permissions?: {
    allow?: string[]
    deny?: string[]
    ask?: string[]
    defaultMode?: string
  }
  hooks?: Record<string, unknown>
  [key: string]: unknown
}

export interface HooksSettings {
  beforeModel?: HookMatcher[]
  afterModel?: HookMatcher[]
  onFunctionCall?: HookMatcher[]
  onToolCall?: HookMatcher[]
  onMaxTokens?: HookMatcher[]
  onError?: HookMatcher[]
  onCompletion?: HookMatcher[]
  [key: string]: HookMatcher[] | undefined
}

export interface HookMatcher {
  match?: string | string[]
  notMatch?: string | string[]
  provider?: string
  tools?: string[]
  command?: string
  handler: string | ((...args: unknown[]) => unknown)
}

export interface Settings {
  version?: string
  pluginConfigs?: Record<string, PluginConfig>
  enabledPlugins?: Record<string, boolean>
  policySettings?: PolicySettings
  agent?: AgentSettings
  [key: string]: unknown
}

export interface PluginConfig {
  options?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface PolicySettings {
  enabledPlugins?: Record<string, boolean>
  blockedPlugins?: string[]
  allowedSources?: string[]
  blockedMarketplaces?: string[]
  strictKnownMarketplaces?: string[] | null
}

export interface AgentSettings {
  model?: string
  timeout?: number
  maxTokens?: number
}

let cachedSettings: Settings | null = null
let settingsCacheTime: number = 0
const CACHE_TTL = 5000

export function getSettings_DEPRECATED(): Settings | null {
  const now = Date.now()

  if (cachedSettings && now - settingsCacheTime < CACHE_TTL) {
    return cachedSettings
  }

  try {
    const settingsPath = `${process.cwd()}/.pakalon/settings.json`
    if (require('fs').existsSync(settingsPath)) {
      const content = require('fs').readFileSync(settingsPath, 'utf-8')
      cachedSettings = JSON.parse(content)
      settingsCacheTime = now
      return cachedSettings
    }
  } catch {}

  return null
}

export function getSettingsForSource(source: string): Settings | null {
  return getSettings_DEPRECATED()
}

export function clearSettingsCache(): void {
  cachedSettings = null
  settingsCacheTime = 0
}

export function updateSettings(settings: Partial<Settings>): void {
  const current = getSettings_DEPRECATED() || {}
  cachedSettings = { ...current, ...settings }
  settingsCacheTime = Date.now()
}

let settingsJsonCache: SettingsJson | null = null

function getSettingsFilePath(source: SettingSource): string | undefined {
  switch (source) {
    case 'userSettings':
      return path.join(os.homedir(), '.config', 'pakalon', 'settings.json')
    case 'projectSettings':
    case 'localSettings':
      return path.join(process.cwd(), '.pakalon', 'settings.json')
    case 'flagSettings':
    case 'policySettings':
      return undefined
  }
}

function parseSettingsFile(filePath: string): {
  settings: SettingsJson | null
  errors: string[]
} {
  try {
    if (!fs.existsSync(filePath)) {
      return { settings: null, errors: [] }
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const settings = JSON.parse(content) as SettingsJson
    return { settings, errors: [] }
  } catch {
    return { settings: null, errors: [`Failed to parse ${filePath}`] }
  }
}

export function getInitialSettings(): SettingsJson {
  if (settingsJsonCache) return settingsJsonCache

  const merged: SettingsJson = {}
  const sources: SettingSource[] = ['userSettings', 'projectSettings', 'localSettings']

  for (const source of sources) {
    const filePath = getSettingsFilePath(source)
    if (!filePath) continue
    const { settings } = parseSettingsFile(filePath)
    if (settings) {
      Object.assign(merged, settings)
    }
  }

  settingsJsonCache = merged
  return merged
}

export function updateSettingsForSource(
  source: EditableSettingSource,
  updates: SettingsJson,
): { error: Error | null } {
  const filePath = getSettingsFilePath(source)
  if (!filePath) {
    return { error: null }
  }

  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let existing: SettingsJson = {}
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      } catch {
        existing = {}
      }
    }

    const updated = { ...existing, ...updates }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    settingsJsonCache = null
    return { error: null }
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

export function resetSettingsCache(): void {
  settingsJsonCache = null
}