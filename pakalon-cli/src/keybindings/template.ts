export function generateKeybindingsTemplate(): string {
  return JSON.stringify(
    {
      bindings: [
        {
          keys: ['Ctrl+K', 'Ctrl+C'],
          action: 'command:compact',
          context: 'Chat',
          description: 'Compact conversation context',
        },
        {
          keys: ['Ctrl+Shift+L'],
          action: 'command:clear',
          context: 'Chat',
          description: 'Clear chat history',
        },
        {
          keys: ['Meta+K'],
          action: 'command:help',
          context: 'Chat',
          description: 'Open help',
        },
      ],
      overrides: [],
    },
    null,
    2,
  )
}

export const TEMPLATE_COMMENTS = `
// Pakalon Keybindings Configuration
//
// Available contexts: global, Chat, Plan, Edit
// Available modifiers: Ctrl, Shift, Meta, Alt
//
// Key aliases: cmd/meta, option/alt, control/ctrl, escape/esc
//
// Format:
// {
//   "bindings": [
//     {
//       "keys": ["Ctrl+K"],
//       "action": "command:compact",
//       "context": "Chat",
//       "description": "Compact conversation"
//     }
//   ],
//   "overrides": [
//     {
//       "keys": ["Ctrl+C"],
//       "action": "custom_interrupt",
//       "context": "global"
//     }
//   ]
// }
//
// Action prefixes:
//   command:*  - Executes a slash command (e.g., "command:compact" -> "/compact")
//   *          - Built-in action (e.g., "submit", "clear_input")
//
// Note: Keybinding customization is in preview.
// Enable with PAKALON_KEYBINDINGS_PREVIEW=1
`.trim()

export function generateKeybindingsTemplateWithComments(): string {
  return `${TEMPLATE_COMMENTS}\n\n${generateKeybindingsTemplate()}`
}
