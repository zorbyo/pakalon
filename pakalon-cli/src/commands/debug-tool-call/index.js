/**
 * Debug Tool Call Command
 * Debug and inspect tool call execution details
 */

import type { Command } from '../../commands.js'

const debugToolCall = {
  type: 'local-jsx',
  name: 'debug-tool-call',
  description: 'Debug and inspect tool call execution details',
  argumentHint: '[tool-name]',
  isHidden: false,

  isEnabled: () => {
    // Debug command available in development or when explicitly enabled
    return process.env.NODE_ENV === 'development' || 
           process.env.PAKALON_DEBUG === 'true'
  },

  load: () => import('./debug-tool-call.js'),
} satisfies Command

export default debugToolCall
