import type { KeyDef, Keybinding, KeyMatchResult } from './schema.js'
import { keysMatch, matchKeySequence } from './resolver.js'

type InputBufferEntry = {
  key: KeyDef
  timestamp: number
}

const MULTI_KEY_TIMEOUT_MS = 1500

export function matchKeybinding(
  bindings: Keybinding[],
  pressed: KeyDef[],
  context: string = 'global',
): KeyMatchResult {
  if (pressed.length === 0) {
    return { matched: false, partialMatch: false }
  }

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
    if (binding.keys.length > pressed.length) {
      let allMatch = true
      for (let i = 0; i < pressed.length; i++) {
        const p = pressed[i]
        const b = binding.keys[i]
        if (!p || !b || !keysMatch(p, b)) {
          allMatch = false
          break
        }
      }
      if (allMatch) {
        hasPartialMatch = true
        break
      }
    }
  }

  return { matched: false, partialMatch: hasPartialMatch }
}

export function shouldWaitForMoreKeys(
  bindings: Keybinding[],
  pressed: KeyDef[],
  lastKeyTime: number,
  context: string = 'global',
): boolean {
  if (pressed.length === 0) return false

  const now = Date.now()
  if (now - lastKeyTime > MULTI_KEY_TIMEOUT_MS) {
    return false
  }

  const contextBindings = bindings.filter(
    b => b.context === 'global' || b.context === context,
  )

  for (const binding of contextBindings) {
    if (binding.keys.length <= pressed.length) continue

    let prefixMatch = true
    for (let i = 0; i < pressed.length; i++) {
      const p = pressed[i]
      const b = binding.keys[i]
      if (!p || !b || !keysMatch(p, b)) {
        prefixMatch = false
        break
      }
    }

    if (prefixMatch) {
      return true
    }
  }

  return false
}

export function normalizeKeyForMatch(key: KeyDef): KeyDef {
  return {
    key: key.key.toLowerCase(),
    ctrl: key.ctrl ?? false,
    shift: key.shift ?? false,
    meta: key.meta ?? false,
    alt: key.alt ?? false,
  }
}
