import type { Keybinding } from './schema.js'

export const RESERVED_SHORTCUTS: ReadonlyArray<{
  keys: string
  action: string
  description: string
}> = [
  { keys: 'Ctrl+C', action: 'interrupt', description: 'Cancel stream or quit' },
  { keys: 'Ctrl+D', action: 'eof', description: 'End of input / exit' },
  { keys: 'Ctrl+L', action: 'clear_screen', description: 'Clear terminal screen' },
  { keys: 'Ctrl+Z', action: 'suspend', description: 'Suspend process' },
  { keys: 'Ctrl+\\', action: 'quit', description: 'Force quit' },
  { keys: 'Tab', action: 'autocomplete', description: 'Trigger autocomplete' },
  { keys: 'Shift+Tab', action: 'autocomplete_prev', description: 'Previous autocomplete' },
  { keys: 'Enter', action: 'submit', description: 'Submit input' },
  { keys: 'Shift+Enter', action: 'newline', description: 'Insert newline' },
  { keys: 'Escape', action: 'cancel', description: 'Cancel / dismiss' },
  { keys: 'Ctrl+U', action: 'clear_input', description: 'Clear input buffer' },
  { keys: 'Ctrl+K', action: 'kill_line_end', description: 'Kill to end of line' },
  { keys: 'Ctrl+A', action: 'home', description: 'Move to start of line' },
  { keys: 'Ctrl+E', action: 'end', description: 'Move to end of line' },
  { keys: 'Ctrl+P', action: 'history_up', description: 'Previous history entry' },
  { keys: 'Ctrl+N', action: 'history_down', description: 'Next history entry' },
  { keys: 'Ctrl+B', action: 'left', description: 'Move cursor left' },
  { keys: 'Ctrl+F', action: 'right', description: 'Move cursor right' },
  { keys: 'Ctrl+H', action: 'backspace', description: 'Delete character before' },
  { keys: 'Ctrl+W', action: 'kill_word_before', description: 'Kill word before cursor' },
  { keys: 'Ctrl+Y', action: 'yank', description: 'Yank from kill ring' },
  { keys: 'Up', action: 'history_up', description: 'Previous history entry' },
  { keys: 'Down', action: 'history_down', description: 'Next history entry' },
  { keys: 'Left', action: 'left', description: 'Move cursor left' },
  { keys: 'Right', action: 'right', description: 'Move cursor right' },
  { keys: 'Home', action: 'home', description: 'Move to start of line' },
  { keys: 'End', action: 'end', description: 'Move to end of line' },
  { keys: 'PageUp', action: 'page_up', description: 'Scroll page up' },
  { keys: 'PageDown', action: 'page_down', description: 'Scroll page down' },
]

const RESERVED_ACTIONS = new Set(RESERVED_SHORTCUTS.map(s => s.action))
const RESERVED_KEY_STRINGS = new Set(RESERVED_SHORTCUTS.map(s => s.keys))

export function isReservedAction(action: string): boolean {
  return RESERVED_ACTIONS.has(action)
}

export function isReservedKeyString(keys: string): boolean {
  return RESERVED_KEY_STRINGS.has(keys)
}

export function getReservedShortcuts(): ReadonlyArray<{
  keys: string
  action: string
  description: string
}> {
  return RESERVED_SHORTCUTS
}

export function isReservedBinding(binding: Keybinding): boolean {
  return (
    isReservedAction(binding.action) ||
    binding.keys.some(k => {
      const parts: string[] = []
      if (k.ctrl) parts.push('Ctrl')
      if (k.shift) parts.push('Shift')
      if (k.meta) parts.push('Meta')
      if (k.alt) parts.push('Alt')
      const keyName = k.key === ' ' ? 'Space' : k.key === '\t' ? 'Tab' : k.key
      parts.push(keyName.charAt(0).toUpperCase() + keyName.slice(1))
      return RESERVED_KEY_STRINGS.has(parts.join('+'))
    })
  )
}
