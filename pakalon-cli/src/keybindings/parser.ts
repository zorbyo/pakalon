import type { KeyDef, BindingDef, Keybinding } from './schema.js'

const KEY_ALIASES = new Map<string, string>([
  ['return', 'enter'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['option', 'alt'],
  ['control', 'ctrl'],
  ['escape', 'esc'],
  ['delete', 'backspace'],
  ['space', ' '],
  ['tab', '\t'],
])

const MODIFIER_KEYS = new Set(['ctrl', 'shift', 'meta', 'alt'])

export function parseKeyString(keyStr: string): KeyDef {
  const parts = keyStr.toLowerCase().split('+').map(p => p.trim())
  const keyDef: KeyDef = {
    key: '',
    ctrl: false,
    shift: false,
    meta: false,
    alt: false,
  }

  for (const part of parts) {
    const normalized = KEY_ALIASES.get(part) ?? part
    if (MODIFIER_KEYS.has(normalized)) {
      keyDef[normalized as keyof Omit<KeyDef, 'key'>] = true
    } else {
      keyDef.key = normalized
    }
  }

  if (!keyDef.key) {
    throw new Error(`Invalid key string: "${keyStr}" - no key found`)
  }

  return keyDef
}

export function parseBinding(obj: Record<string, unknown>): BindingDef {
  const keys = obj.keys
  if (!keys) {
    throw new Error('Binding missing "keys" field')
  }

  const parsedKeys = Array.isArray(keys)
    ? keys.map(k => (typeof k === 'string' ? parseKeyString(k) : k as KeyDef))
    : typeof keys === 'string'
      ? [parseKeyString(keys)]
      : []

  if (parsedKeys.length === 0) {
    throw new Error('Binding has no valid keys')
  }

  const action = obj.action
  if (!action || typeof action !== 'string') {
    throw new Error('Binding missing "action" field')
  }

  return {
    keys: parsedKeys,
    action,
    context: typeof obj.context === 'string' ? obj.context : 'global',
    description: typeof obj.description === 'string' ? obj.description : undefined,
    when: typeof obj.when === 'string' ? obj.when : undefined,
  }
}

export function parseKeybindingsConfig(
  raw: Record<string, unknown> | string,
): { bindings: BindingDef[]; overrides: BindingDef[] } {
  const config = typeof raw === 'string' ? JSON.parse(raw) : raw

  const bindings: BindingDef[] = []
  const overrides: BindingDef[] = []

  const rawBindings = config.bindings ?? config.keybindings ?? []
  const rawOverrides = config.overrides ?? []

  for (const b of rawBindings) {
    try {
      bindings.push(parseBinding(b as Record<string, unknown>))
    } catch {
      // Skip invalid bindings silently
    }
  }

  for (const o of rawOverrides) {
    try {
      overrides.push(parseBinding(o as Record<string, unknown>))
    } catch {
      // Skip invalid overrides silently
    }
  }

  return { bindings, overrides }
}

export function keyToString(key: KeyDef): string {
  const parts: string[] = []
  if (key.ctrl) parts.push('Ctrl')
  if (key.shift) parts.push('Shift')
  if (key.meta) parts.push('Meta')
  if (key.alt) parts.push('Alt')

  const keyName = key.key === ' ' ? 'Space' : key.key === '\t' ? 'Tab' : key.key
  parts.push(keyName.charAt(0).toUpperCase() + keyName.slice(1))

  return parts.join('+')
}

export function bindingToString(binding: BindingDef | Keybinding): string {
  return binding.keys.map(keyToString).join(' ')
}
