import React, { createContext, useContext, useMemo, useState, useCallback } from 'react'
import type { Keybinding, KeybindingContext } from './schema.js'
import { getDefaultBindings } from './defaultBindings.js'
import { loadUserBindings, isKeybindingCustomizationEnabled } from './loadUserBindings.js'

const KeybindingContextObj = createContext<KeybindingContext | null>(null)

export function useKeybindingContext(): KeybindingContext {
  const ctx = useContext(KeybindingContextObj)
  if (!ctx) {
    throw new Error('useKeybindingContext must be used within KeybindingProviderSetup')
  }
  return ctx
}

export function useOptionalKeybindingContext(): KeybindingContext | null {
  return useContext(KeybindingContextObj)
}

type KeybindingProviderSetupProps = {
  children: React.ReactNode
  initialBindings?: Keybinding[]
}

export function KeybindingProviderSetup({
  children,
  initialBindings,
}: KeybindingProviderSetupProps): React.ReactNode {
  const [bindings, setBindings] = useState<Keybinding[]>(() => {
    if (initialBindings) return initialBindings

    const defaults = getDefaultBindings()

    if (!isKeybindingCustomizationEnabled()) {
      return defaults
    }

    try {
      const userConfig = loadUserBindings()
      const userBindings: Keybinding[] = userConfig.bindings.map(b => ({
        keys: b.keys,
        action: b.action,
        context: b.context ?? 'global',
        description: b.description,
        when: b.when,
        source: 'user' as const,
      }))

      const overrideBindings: Keybinding[] = userConfig.overrides.map(b => ({
        keys: b.keys,
        action: b.action,
        context: b.context ?? 'global',
        description: b.description,
        when: b.when,
        source: 'override' as const,
      }))

      const merged = [...defaults]

      for (const override of overrideBindings) {
        const idx = merged.findIndex(
          b => b.action === override.action && b.context === override.context,
        )
        if (idx >= 0) {
          merged[idx] = override
        } else {
          merged.push(override)
        }
      }

      for (const user of userBindings) {
        const exists = merged.some(
          b => b.action === user.action && b.context === user.context,
        )
        if (!exists) {
          merged.push(user)
        }
      }

      return merged
    } catch {
      return defaults
    }
  })

  const register = useCallback((binding: Omit<Keybinding, 'source'>) => {
    setBindings(prev => {
      const idx = prev.findIndex(
        b => b.action === binding.action && b.context === binding.context,
      )
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...binding, source: 'default' }
        return next
      }
      return [...prev, { ...binding, source: 'default' }]
    })
  }, [])

  const unregister = useCallback((action: string) => {
    setBindings(prev => prev.filter(b => b.action !== action))
  }, [])

  const contextValue = useMemo<KeybindingContext>(
    () => ({ bindings, register, unregister }),
    [bindings, register, unregister],
  )

  return (
    React.createElement(KeybindingContextObj.Provider, { value: contextValue }, children)
  )
}

export default KeybindingProviderSetup
