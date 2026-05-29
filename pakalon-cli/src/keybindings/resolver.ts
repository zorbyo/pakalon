import type { KeyDef, Keybinding, KeyMatchResult } from './schema.js'

export function keysMatch(a: KeyDef, b: KeyDef): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.meta === b.meta &&
    a.alt === b.alt
  )
}

export function matchKeySequence(
  pressed: KeyDef[],
  binding: Keybinding,
): KeyMatchResult {
  if (pressed.length === 0) {
    return { matched: false, partialMatch: false }
  }

  const bindingKeys = binding.keys

  if (pressed.length > bindingKeys.length) {
    return { matched: false, partialMatch: false }
  }

  for (let i = 0; i < pressed.length; i++) {
    const p = pressed[i]
    const b = bindingKeys[i]
    if (!p || !b || !keysMatch(p, b)) {
      return { matched: false, partialMatch: false }
    }
  }

  if (pressed.length === bindingKeys.length) {
    return { matched: true, binding, partialMatch: false }
  }

  return { matched: false, partialMatch: true }
}

export function resolveKeybindings(
  bindings: Keybinding[],
  pressed: KeyDef[],
  context: string = 'global',
): KeyMatchResult {
  const contextBindings = bindings.filter(
    b => b.context === 'global' || b.context === context,
  )

  for (const binding of contextBindings) {
    const result = matchKeySequence(pressed, binding)
    if (result.matched) {
      return result
    }
  }

  let hasPartialMatch = false
  for (const binding of contextBindings) {
    const result = matchKeySequence(pressed, binding)
    if (result.partialMatch) {
      hasPartialMatch = true
      break
    }
  }

  return { matched: false, partialMatch: hasPartialMatch }
}

export function findBindingByAction(
  bindings: Keybinding[],
  action: string,
  context: string = 'global',
): Keybinding | undefined {
  return bindings.find(
    b =>
      b.action === action &&
      (b.context === 'global' || b.context === context),
  )
}

export function getBindingsForContext(
  bindings: Keybinding[],
  context: string,
): Keybinding[] {
  return bindings.filter(
    b => b.context === 'global' || b.context === context,
  )
}
