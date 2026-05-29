import { useMemo } from 'react'
import { keyToString } from './parser.js'
import { findBindingByAction } from './resolver.js'
import type { Keybinding } from './schema.js'

export function useShortcutDisplay(
  bindings: Keybinding[],
  action: string,
  context: string = 'global',
): string | undefined {
  return useMemo(() => {
    const binding = findBindingByAction(bindings, action, context)
    if (!binding) return undefined
    return binding.keys.map(keyToString).join(' ')
  }, [bindings, action, context])
}

export function useShortcutDisplayMap(
  bindings: Keybinding[],
  actions: string[],
  context: string = 'global',
): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const action of actions) {
      const binding = findBindingByAction(bindings, action, context)
      if (binding) {
        map.set(action, binding.keys.map(keyToString).join(' '))
      }
    }
    return map
  }, [bindings, actions, context])
}

export function formatShortcutForPlatform(shortcut: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  return shortcut
    .replace(/Meta/g, isMac ? '' : 'Win')
    .replace(/Alt/g, isMac ? '' : 'Alt')
    .replace(/Ctrl/g, isMac ? '' : 'Ctrl')
    .replace(/Shift/g, isMac ? '' : 'Shift')
}
