export type CommandAvailability = 'claude-ai' | 'openrouter' | 'local' | 'all'

export interface LocalCommandCall {
  (args?: string): Promise<{ type: 'text'; value: string }>
}

export interface Command {
  type: 'local' | 'jsx' | 'remote'
  name: string
  description: string
  availability?: CommandAvailability[]
  isEnabled?: () => boolean
  isHidden?: boolean
  supportsNonInteractive?: boolean
  load?: () => Promise<{ call: LocalCommandCall }>
  aliases?: string[]
  category?: string
  requiresAuth?: boolean
}

export type { CommandDefinition, CommandResult, CommandContext } from './commands/types.js'
