/**
 * Share Command
 * Share the current conversation or session
 */

import type { Command } from '../../commands.js'

const share = {
  type: 'local-jsx',
  name: 'share',
  description: 'Share the current conversation as a link or file',
  argumentHint: '[format]',
  isHidden: false,

  isEnabled: () => {
    // Share is available when user is authenticated
    return true
  },

  load: () => import('./share.js'),
} satisfies Command

export default share
