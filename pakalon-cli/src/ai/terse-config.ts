/**
 * Terse Mode Configuration System
 *
 * Manages default terse mode settings with priority:
 * 1. Environment variable (PAKALON_TERSE_MODE)
 * 2. Config file (~/.config/pakalon/terse.json)
 * 3. Default 'full'
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const TERSE_VALID_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress'
] as const

export type TersenessMode = typeof TERSE_VALID_MODES[number]

function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'pakalon', 'terse')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'pakalon',
      'terse'
    )
  }
  return path.join(os.homedir(), '.config', 'pakalon', 'terse')
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

export interface TersenessConfig {
  defaultMode: TersenessMode
  autoActivate: boolean
  showStatusline: boolean
}

export function getTerseConfig(): TersenessConfig {
  const envMode = process.env.PAKALON_TERSE_MODE
  if (envMode && TERSE_VALID_MODES.includes(envMode as TersenessMode)) {
    return {
      defaultMode: envMode as TersenessMode,
      autoActivate: process.env.PAKALON_TERSE_AUTO !== 'false',
      showStatusline: process.env.PAKALON_TERSE_STATUSLINE !== 'false',
    }
  }

  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.defaultMode && TERSE_VALID_MODES.includes(config.defaultMode as TersenessMode)) {
        return {
          defaultMode: config.defaultMode as TersenessMode,
          autoActivate: config.autoActivate !== false,
          showStatusline: config.showStatusline !== false,
        }
      }
    }
  } catch {
    // Config file doesn't exist or is invalid — fall through
  }

  return {
    defaultMode: 'full',
    autoActivate: true,
    showStatusline: true,
  }
}

export function setTerseMode(mode: TersenessMode): void {
  const config = getTerseConfig()
  config.defaultMode = mode

  const configPath = getConfigPath()
  const configDir = path.dirname(configPath)

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function setTerseConfig(updates: Partial<TersenessConfig>): void {
  const config = getTerseConfig()
  Object.assign(config, updates)

  const configPath = getConfigPath()
  const configDir = path.dirname(configPath)

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

export function resetTerseConfig(): void {
  const configPath = getConfigPath()
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath)
  }
}

export function getTerseModeFromCommand(command: string): TersenessMode | null {
  const normalized = command.toLowerCase().trim()

  if (normalized === 'off' || /normal\s*mode/.test(normalized)) {
    return 'off'
  }

  if (normalized === 'lite') return 'lite'
  if (normalized === 'full' || normalized === '') return 'full'
  if (normalized === 'ultra') return 'ultra'
  if (normalized === 'wenyan-lite') return 'wenyan-lite'
  if (normalized === 'wenyan' || normalized === 'wenyan-full') return 'wenyan'
  if (normalized === 'wenyan-ultra') return 'wenyan-ultra'
  if (normalized === 'commit') return 'commit'
  if (normalized === 'review') return 'review'
  if (normalized === 'compress') return 'compress'

  return null
}

export function isTerseDeactivation(input: string): boolean {
  return /\b(stop\s*terse|normal\s*mode)\b/i.test(input)
}

export function isTerseActivation(input: string): boolean {
  return /^\/terse\b/i.test(input)
}

export function getTerseStatusBadge(mode: TersenessMode): string {
  if (mode === 'off' || mode === undefined) {
    return ''
  }
  if (mode === 'full' || mode === '') {
    return '[TERSE]'
  }
  return `[TERSE:${mode.toUpperCase()}]`
}