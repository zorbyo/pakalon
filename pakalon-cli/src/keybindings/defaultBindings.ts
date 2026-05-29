import type { Keybinding } from './schema.js'

export const DEFAULT_BINDINGS: Keybinding[] = [
  {
    keys: [{ key: 'c', ctrl: true }],
    action: 'interrupt',
    context: 'global',
    description: 'Cancel stream or quit',
    source: 'default',
  },
  {
    keys: [{ key: 'd', ctrl: true }],
    action: 'eof',
    context: 'global',
    description: 'End of input / exit',
    source: 'default',
  },
  {
    keys: [{ key: 'l', ctrl: true }],
    action: 'clear_screen',
    context: 'global',
    description: 'Clear terminal screen',
    source: 'default',
  },
  {
    keys: [{ key: 'u', ctrl: true }],
    action: 'clear_input',
    context: 'Chat',
    description: 'Clear input buffer',
    source: 'default',
  },
  {
    keys: [{ key: 'k', ctrl: true }],
    action: 'kill_line_end',
    context: 'Chat',
    description: 'Kill to end of line',
    source: 'default',
  },
  {
    keys: [{ key: 'a', ctrl: true }],
    action: 'home',
    context: 'Chat',
    description: 'Move to start of line',
    source: 'default',
  },
  {
    keys: [{ key: 'e', ctrl: true }],
    action: 'end',
    context: 'Chat',
    description: 'Move to end of line',
    source: 'default',
  },
  {
    keys: [{ key: 'p', ctrl: true }],
    action: 'history_up',
    context: 'Chat',
    description: 'Previous history entry',
    source: 'default',
  },
  {
    keys: [{ key: 'n', ctrl: true }],
    action: 'history_down',
    context: 'Chat',
    description: 'Next history entry',
    source: 'default',
  },
  {
    keys: [{ key: 'b', ctrl: true }],
    action: 'left',
    context: 'Chat',
    description: 'Move cursor left',
    source: 'default',
  },
  {
    keys: [{ key: 'f', ctrl: true }],
    action: 'right',
    context: 'Chat',
    description: 'Move cursor right',
    source: 'default',
  },
  {
    keys: [{ key: 'h', ctrl: true }],
    action: 'backspace',
    context: 'Chat',
    description: 'Delete character before cursor',
    source: 'default',
  },
  {
    keys: [{ key: 'w', ctrl: true }],
    action: 'kill_word_before',
    context: 'Chat',
    description: 'Kill word before cursor',
    source: 'default',
  },
  {
    keys: [{ key: 'y', ctrl: true }],
    action: 'yank',
    context: 'Chat',
    description: 'Yank from kill ring',
    source: 'default',
  },
  {
    keys: [{ key: 'enter' }],
    action: 'submit',
    context: 'Chat',
    description: 'Send message',
    source: 'default',
  },
  {
    keys: [{ key: 'enter', shift: true }],
    action: 'newline',
    context: 'Chat',
    description: 'Insert newline',
    source: 'default',
  },
  {
    keys: [{ key: 'tab' }],
    action: 'autocomplete',
    context: 'Chat',
    description: 'Trigger autocomplete',
    source: 'default',
  },
  {
    keys: [{ key: 'tab', shift: true }],
    action: 'autocomplete_prev',
    context: 'Chat',
    description: 'Previous autocomplete item',
    source: 'default',
  },
  {
    keys: [{ key: 'o', ctrl: true }],
    action: 'toggle_verbose',
    context: 'Chat',
    description: 'Toggle verbose panel',
    source: 'default',
  },
  {
    keys: [{ key: 'k', ctrl: true, shift: true }],
    action: 'command:compact',
    context: 'Chat',
    description: 'Compact conversation context',
    source: 'default',
  },
  {
    keys: [{ key: 'r', ctrl: true }],
    action: 'command:clear',
    context: 'Chat',
    description: 'Clear chat history',
    source: 'default',
  },
]

export function getDefaultBindings(): Keybinding[] {
  return [...DEFAULT_BINDINGS]
}

export function getDefaultBindingForAction(action: string): Keybinding | undefined {
  return DEFAULT_BINDINGS.find(b => b.action === action)
}
