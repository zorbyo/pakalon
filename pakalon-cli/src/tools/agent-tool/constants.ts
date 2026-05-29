/**
 * Agent Tool Constants
 */

export const AGENT_TOOL_NAME = 'Agent';
export const LEGACY_AGENT_TOOL_NAME = 'Task';

export const DEFAULT_AGENT_MODEL = 'anthropic/claude-3-5-sonnet';

export const EFFORT_LEVELS = ['minimum', 'low', 'medium', 'high', 'maximum'] as const;

export const PERMISSION_MODES = [
  'acceptEdits',
  'ask',
  'auto',
  'bypassPermissions',
  'bubble',
  'plan',
  'restrictToolUse',
] as const;

export const AGENT_COLORS = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;

export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  'Read',
  'WebSearch',
  'WebFetch',
  'Glob',
  'Grep',
  'LSPSearch',
  'TodoWrite',
  'ExitPlanMode',
  'Skill',
  'Task',
  'TaskFleet',
]);

export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  'Agent',
  'TaskFleet',
  'ExitPlanMode',
]);

export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  'Agent',
  'ExitPlanMode',
]);

export const INTERNAL_WORKER_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'NotebookEdit',
  'Task',
  'TodoWrite',
];

export const FORK_BOILERPLATE_TAG = 'fork_worker_notice';
export const FORK_DIRECTIVE_PREFIX = '\n\nDirective: ';

export const MAX_AGENT_TURNS = 200;
export const DEFAULT_AGENT_TIMEOUT_MS = 300000;
export const DEFAULT_SUBAGENT_MAX_TURNS = 50;