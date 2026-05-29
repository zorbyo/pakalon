import { keyToString } from './parser.js'
import type { Keybinding } from './schema.js'

export function formatShortcut(binding: Keybinding): string {
  return binding.keys.map(keyToString).join(' ')
}

export function formatShortcutList(bindings: Keybinding[]): string {
  const lines: string[] = []

  for (const binding of bindings) {
    const shortcut = formatShortcut(binding)
    const desc = binding.description ?? binding.action
    lines.push(`${shortcut.padEnd(25)} ${desc}`)
  }

  return lines.join('\n')
}

export function formatShortcutTable(bindings: Keybinding[]): string {
  const lines: string[] = []
  lines.push('| Shortcut | Action | Description |')
  lines.push('|----------|--------|-------------|')

  for (const binding of bindings) {
    const shortcut = formatShortcut(binding)
    const action = `\`${binding.action}\``
    const desc = binding.description ?? ''
    lines.push(`| ${shortcut} | ${action} | ${desc} |`)
  }

  return lines.join('\n')
}

export function formatShortcutMarkdown(bindings: Keybinding[]): string {
  return formatShortcutTable(bindings)
}

export function formatShortcutPlain(
  binding: Keybinding,
  { showContext = false }: { showContext?: boolean } = {},
): string {
  const shortcut = formatShortcut(binding)
  const parts = [shortcut, binding.action]
  if (showContext && binding.context !== 'global') {
    parts.push(`[${binding.context}]`)
  }
  if (binding.description) {
    parts.push(`— ${binding.description}`)
  }
  return parts.join('  ')
}

const MODIFIER_LABELS: Record<string, string> = {
  ctrl: 'Ctrl',
  meta: 'Cmd',
  alt: 'Alt',
  shift: 'Shift',
}

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  return: 'Enter',
  escape: 'Esc',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

export function getShortcutDisplay(
  action: string,
  _context: string,
  defaultKey: string,
): string {
  const key = defaultKey.toLowerCase()
  const label = KEY_LABELS[key] ?? key.toUpperCase()
  if (label === 'Space') return 'Space'
  return label
}
