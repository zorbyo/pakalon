import type { BindingDef, Keybinding } from './schema.js'
import { isReservedAction } from './reservedShortcuts.js'

export type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateBindings(
  bindings: BindingDef[],
  { allowReserved = false }: { allowReserved?: boolean } = {},
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (bindings.length === 0) {
    return { valid: true, errors: [], warnings: ['No bindings defined'] }
  }

  const actionSet = new Set<string>()
  const keyStringSet = new Set<string>()

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]
    if (!binding) continue

    const prefix = `Binding #${i + 1} (${binding.action})`

    if (!binding.action) {
      errors.push(`${prefix}: missing action`)
      continue
    }

    if (binding.keys.length === 0) {
      errors.push(`${prefix}: no keys defined`)
      continue
    }

    const keyString = binding.keys
      .map(k => {
        const parts: string[] = []
        if (k.ctrl) parts.push('Ctrl')
        if (k.shift) parts.push('Shift')
        if (k.meta) parts.push('Meta')
        if (k.alt) parts.push('Alt')
        const keyName = k.key === ' ' ? 'Space' : k.key === '\t' ? 'Tab' : k.key
        parts.push(keyName.charAt(0).toUpperCase() + keyName.slice(1))
        return parts.join('+')
      })
      .join(' ')

    if (keyStringSet.has(keyString)) {
      warnings.push(`${prefix}: duplicate key sequence "${keyString}"`)
    }
    keyStringSet.add(keyString)

    if (actionSet.has(binding.action)) {
      warnings.push(`${prefix}: duplicate action "${binding.action}"`)
    }
    actionSet.add(binding.action)

    if (!allowReserved && isReservedAction(binding.action)) {
      warnings.push(`${prefix}: action "${binding.action}" is a reserved shortcut`)
    }

    for (const key of binding.keys) {
      if (!key.key && !key.ctrl && !key.shift && !key.meta && !key.alt) {
        errors.push(`${prefix}: invalid key definition`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

export function validateKeybinding(binding: Keybinding): ValidationResult {
  return validateBindings([
    {
      keys: binding.keys,
      action: binding.action,
      context: binding.context,
      description: binding.description,
      when: binding.when,
    },
  ])
}
