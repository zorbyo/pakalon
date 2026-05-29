import { useEffect, useRef, useCallback } from 'react'
import type { KeyDef, Keybinding } from './schema.js'
import { matchKeybinding } from './match.js'

type UseKeybindingsOptions = {
  context?: string
  isActive?: boolean
  priority?: number
}

type KeybindingHandler = () => void

export function useKeybindings(
  handlers: Record<string, KeybindingHandler>,
  options: UseKeybindingsOptions = {},
): void {
  const { context = 'global', isActive = true, priority = 0 } = options
  const handlersRef = useRef(handlers)
  const isActiveRef = useRef(isActive)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActiveRef.current) return

      const keyDef: KeyDef = {
        key: e.key.toLowerCase(),
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        meta: e.metaKey,
        alt: e.altKey,
      }

      const bindings: Keybinding[] = Object.entries(handlersRef.current).map(
        ([action]) => ({
          keys: [keyDef],
          action,
          context,
          source: 'default',
        }),
      )

      const result = matchKeybinding(bindings, [keyDef], context)

      if (result.matched && result.binding) {
        const handler = handlersRef.current[result.binding.action]
        if (handler) {
          e.preventDefault()
          e.stopPropagation()
          handler()
        }
      }
    },
    [context],
  )

  useEffect(() => {
    if (!isActive) return

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isActive, handleKeyDown, priority])
}

export function useKeybinding(
  action: string,
  handler: KeybindingHandler,
  options: UseKeybindingsOptions = {},
): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const stableHandler = useCallback(() => {
    handlerRef.current()
  }, [])

  useKeybindings({ [action]: stableHandler }, options)
}
