/**
 * Issue Command
 * Create and manage GitHub issues from the CLI
 */

import type { Command } from '../../commands.js'

const issue = {
  type: 'local-jsx',
  name: 'issue',
  description: 'Create or manage GitHub issues',
  argumentHint: '[action] [options]',
  isHidden: false,

  isEnabled: () => {
    // Issue command available when in a git repository
    return true
  },

  load: () => import('./issue.js'),
} satisfies Command

export default issue
