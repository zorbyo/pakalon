/**
 * Teleport Command
 * Remote session management - teleport CLI sessions to remote environments
 */

import type { Command } from '../../commands.js'

const teleport = {
  type: 'local-jsx',
  name: 'teleport',
  description: 'Teleport current session to a remote environment',
  argumentHint: '[target]',
  isHidden: false,
  
  isEnabled: () => {
    // Enable if teleport feature is available
    return true
  },

  load: () => import('./teleport.js'),
} satisfies Command

export default teleport
