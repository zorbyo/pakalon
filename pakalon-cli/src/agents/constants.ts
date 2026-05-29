export const AGENT_TOOL_NAME = 'Agent';
export const LEGACY_AGENT_TOOL_NAME = 'Task';
export const VERIFICATION_AGENT_TYPE = 'verification';

export const AGENT_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const;

export type AgentColorName = typeof AGENT_COLORS[number];

export const AGENT_COLOR_TO_THEME_COLOR: Record<AgentColorName, string> = {
  red: 'red_FOR_SUBAGENTS_ONLY',
  blue: 'blue_FOR_SUBAGENTS_ONLY',
  green: 'green_FOR_SUBAGENTS_ONLY',
  yellow: 'yellow_FOR_SUBAGENTS_ONLY',
  purple: 'purple_FOR_SUBAGENTS_ONLY',
  orange: 'orange_FOR_SUBAGENTS_ONLY',
  pink: 'pink_FOR_SUBAGENTS_ONLY',
  cyan: 'cyan_FOR_SUBAGENTS_ONLY',
};

export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
]);

export const ASYNC_AGENT_ALLOWED_TOOLS = new Set<string>([
  'Read',
  'WebSearch',
  'TodoWrite',
  'Grep',
  'WebFetch',
  'Glob',
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Skill',
  'ToolSearch',
  'EnterWorktree',
  'ExitWorktree',
  'Agent',
]);

export const ALL_AGENT_DISALLOWED_TOOLS = new Set<string>([
  'TaskOutput',
  'ExitPlanMode',
  'EnterPlanMode',
  'Agent',
  'AskUserQuestion',
  'TaskStop',
  'Workflow',
]);

export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set<string>([
  'TaskOutput',
  'ExitPlanMode',
  'EnterPlanMode',
  'Agent',
  'AskUserQuestion',
  'TaskStop',
  'Workflow',
]);

export const IN_PROCESS_TEAMMATE_ALLOWED_TOOLS = new Set<string>([
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'SendMessage',
]);

export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set<string>([
  'Agent',
  'TaskStop',
  'SendMessage',
  'TaskOutput',
]);

export const FORK_SUBAGENT_TYPE = 'fork';
export const FORK_BOILERPLATE_TAG = 'fork-boilerplate';
export const FORK_DIRECTIVE_PREFIX = 'Fork directive: ';