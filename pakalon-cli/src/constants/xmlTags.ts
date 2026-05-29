/**
 * XML tag names used for message formatting and parsing
 */

// XML tag names used to mark skill/command metadata in messages
export const COMMAND_NAME_TAG = 'command-name'
export const COMMAND_MESSAGE_TAG = 'command-message'
export const COMMAND_ARGS_TAG = 'command-args'

// XML tag names for terminal/bash command input and output in user messages
// These wrap content that represents terminal activity, not actual user prompts
export const BASH_INPUT_TAG = 'bash-input'
export const BASH_STDOUT_TAG = 'bash-stdout'
export const BASH_STDERR_TAG = 'bash-stderr'
export const LOCAL_COMMAND_STDOUT_TAG = 'local-command-stdout'
export const LOCAL_COMMAND_STDERR_TAG = 'local-command-stderr'
export const LOCAL_COMMAND_CAVEAT_TAG = 'local-command-caveat'

// All terminal-related tags that indicate a message is terminal output, not a user prompt
export const TERMINAL_OUTPUT_TAGS = [
  BASH_INPUT_TAG,
  BASH_STDOUT_TAG,
  BASH_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
] as const

export const TICK_TAG = 'tick'

// XML tag names for task notifications (background task completions)
export const TASK_NOTIFICATION_TAG = 'task-notification'
export const TASK_ID_TAG = 'task-id'
export const TOOL_USE_ID_TAG = 'tool-use-id'
export const TASK_TYPE_TAG = 'task-type'
export const OUTPUT_FILE_TAG = 'output-file'
export const STATUS_TAG = 'status'
export const SUMMARY_TAG = 'summary'
export const REASON_TAG = 'reason'
export const WORKTREE_TAG = 'worktree'
export const WORKTREE_PATH_TAG = 'worktreePath'
export const WORKTREE_BRANCH_TAG = 'worktreeBranch'

// XML tag names for ultraplan mode (remote parallel planning sessions)
export const ULTRAPLAN_TAG = 'ultraplan'

// XML tag name for remote /review results (teleported review session output)
export const REMOTE_REVIEW_TAG = 'remote-review'

// Remote review progress tag for heartbeat monitoring
export const REMOTE_REVIEW_PROGRESS_TAG = 'remote-review-progress'

// XML tag name for teammate messages (swarm inter-agent communication)
export const TEAMMATE_MESSAGE_TAG = 'teammate-message'

// XML tag name for external channel messages
export const CHANNEL_MESSAGE_TAG = 'channel-message'
export const CHANNEL_TAG = 'channel'

// XML tag name for cross-session UDS messages (another session's inbox)
export const CROSS_SESSION_MESSAGE_TAG = 'cross-session-message'

// XML tag wrapping the rules/format boilerplate in a fork child's first message
export const FORK_BOILERPLATE_TAG = 'fork-boilerplate'
// Prefix before the directive text, stripped by the renderer
export const FORK_DIRECTIVE_PREFIX = 'Your directive: '

// Phase-related tags for 6-phase workflow
export const PHASE_TAG = 'phase'
export const PHASE_ID_TAG = 'phase-id'
export const PHASE_STATUS_TAG = 'phase-status'
export const PHASE_OUTPUT_TAG = 'phase-output'
export const PHASE_ERROR_TAG = 'phase-error'

// Agent/Fleet tags
export const AGENT_TAG = 'agent'
export const AGENT_ID_TAG = 'agent-id'
export const AGENT_STATUS_TAG = 'agent-status'
export const FLEET_TAG = 'fleet'
export const FLEET_ID_TAG = 'fleet-id'
export const FLEET_RESULT_TAG = 'fleet-result'

// Memory tags
export const MEMORY_TAG = 'memory'
export const MEMORY_ID_TAG = 'memory-id'
export const MEMORY_CONTENT_TAG = 'memory-content'

// Context tags
export const CONTEXT_TAG = 'context'
export const CONTEXT_SUMMARY_TAG = 'context-summary'
export const CONTEXT_FILES_TAG = 'context-files'

// Common argument patterns for slash commands that request help
export const COMMON_HELP_ARGS = ['help', '-h', '--help']

// Common argument patterns for slash commands that request current state/info
export const COMMON_INFO_ARGS = [
  'list',
  'show',
  'display',
  'current',
  'view',
  'get',
  'check',
  'describe',
  'print',
  'version',
  'about',
  'status',
  '?',
]

/**
 * Helper function to wrap content in an XML tag
 */
export function wrapInTag(tagName: string, content: string, attributes?: Record<string, string>): string {
  const attrString = attributes
    ? ' ' + Object.entries(attributes).map(([k, v]) => `${k}="${v}"`).join(' ')
    : ''
  return `<${tagName}${attrString}>${content}</${tagName}>`
}

/**
 * Helper function to extract content from an XML tag
 */
export function extractFromTag(tagName: string, text: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i')
  const match = text.match(regex)
  return match ? match[1] : null
}

/**
 * Check if text contains a specific XML tag
 */
export function hasTag(tagName: string, text: string): boolean {
  const regex = new RegExp(`<${tagName}[^>]*>`, 'i')
  return regex.test(text)
}
