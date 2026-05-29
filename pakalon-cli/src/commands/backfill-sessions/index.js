/**
 * Backfill Sessions Command
 * Backfill session metadata and repair session storage
 */

import type { Command } from '../../commands.js'

const backfillSessions = {
  type: 'local-jsx',
  name: 'backfill-sessions',
  description: 'Backfill session metadata and repair session storage',
  argumentHint: '[--dry-run]',
  isHidden: true, // Internal maintenance command

  isEnabled: () => {
    // Available in development or when explicitly enabled
    return process.env.NODE_ENV === 'development' || 
           process.env.PAKALON_ADMIN === 'true'
  },

  load: () => import('./backfill-sessions.js'),
} satisfies Command

export default backfillSessions
