import { existsSync, readFileSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import type { BindingDef, KeybindingsConfig } from './schema.js'
import { parseKeybindingsConfig } from './parser.js'

const PREVIEW_FLAG = 'PAKALON_KEYBINDINGS_PREVIEW'

function getConfigDir(): string {
  if (process.env.PAKALON_CONFIG_DIR) {
    return process.env.PAKALON_CONFIG_DIR
  }
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'pakalon')
  }
  return join(homedir(), '.config', 'pakalon')
}

export function getKeybindingsPath(): string {
  return join(getConfigDir(), 'keybindings.json')
}

export function isKeybindingCustomizationEnabled(): boolean {
  return process.env[PREVIEW_FLAG] === '1' || process.env[PREVIEW_FLAG] === 'true'
}

export function loadUserBindings(): KeybindingsConfig {
  const path = getKeybindingsPath()

  if (!existsSync(path)) {
    return { bindings: [], overrides: [] }
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result = parseKeybindingsConfig(parsed)
    return {
      bindings: result.bindings,
      overrides: result.overrides,
    }
  } catch {
    return { bindings: [], overrides: [] }
  }
}

export function loadUserBindingsRaw(): string | null {
  const path = getKeybindingsPath()

  if (!existsSync(path)) {
    return null
  }

  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

export function validateBindingFile(path: string): {
  valid: boolean
  errors: string[]
  bindings: BindingDef[]
} {
  if (!existsSync(path)) {
    return { valid: false, errors: ['File not found'], bindings: [] }
  }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result = parseKeybindingsConfig(parsed)
    return {
      valid: true,
      errors: [],
      bindings: [...result.bindings, ...result.overrides],
    }
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : String(e)],
      bindings: [],
    }
  }
}
