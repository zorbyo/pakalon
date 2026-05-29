export {
  getBuiltInAgents,
  getBuiltInAgent,
  clearBuiltInAgentsCache,
} from '../builtInAgents.js';

export {
  GENERAL_PURPOSE_AGENT,
  EXPLORE_AGENT,
  PLAN_AGENT,
  VERIFICATION_AGENT,
} from '../builtInAgents.js';

import type { BuiltInAgentDefinition } from './types.js';
import { AGENT_COLORS } from './constants.js';

const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Read-only file search and exploration specialist',
  whenToUse: 'Use this agent to explore codebase, find files, or search for patterns without making any changes.',
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit'],
  model: 'inherit',
  color: 'blue',
  effort: 'medium',
  readOnly: true,
  omitClaudeMd: true,
  background: false,
};

const PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'Plan',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Read-only software architect that creates implementation plans',
  whenToUse: 'Use this agent to plan implementation approaches or analyze architecture.',
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'TaskCreate', 'TaskUpdate'],
  model: 'inherit',
  color: 'purple',
  effort: 'medium',
  readOnly: true,
  omitClaudeMd: false,
  background: false,
};

const VERIFICATION_AGENT: BuiltInAgentDefinition = {
  agentType: 'Verification',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Verification specialist that tries to break implementations',
  whenToUse: 'Use this agent to verify builds, test implementations, and check for issues.',
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'TaskCreate', 'TaskUpdate', 'WebSearch', 'WebFetch'],
  model: 'inherit',
  color: 'red',
  effort: 'high',
  readOnly: true,
  omitClaudeMd: false,
  background: true,
};

const GENERAL_PURPOSE_AGENT: BuiltInAgentDefinition = {
  agentType: 'GeneralPurpose',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Default general purpose agent for any task',
  whenToUse: 'Use this agent as a fallback when no specific agent type is needed.',
  tools: ['*'],
  disallowedTools: [],
  model: 'inherit',
  color: 'green',
  effort: 'medium',
  background: true,
};

const DEBUG_AGENT: BuiltInAgentDefinition = {
  agentType: 'Debug',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Debugging specialist for finding and fixing issues',
  whenToUse: 'Use this agent to debug problems, analyze errors, or investigate issues.',
  disallowedTools: ['Agent'],
  model: 'inherit',
  color: 'orange',
  effort: 'high',
  background: false,
};

const REFACTOR_AGENT: BuiltInAgentDefinition = {
  agentType: 'Refactor',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Refactoring specialist for code improvements',
  whenToUse: 'Use this agent to refactor code, improve structure, or modernize implementations.',
  disallowedTools: ['Agent'],
  model: 'inherit',
  color: 'yellow',
  effort: 'high',
  background: false,
};

const TEST_AGENT: BuiltInAgentDefinition = {
  agentType: 'Test',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Testing specialist for writing and running tests',
  whenToUse: 'Use this agent to write tests, run test suites, or improve test coverage.',
  disallowedTools: ['Agent'],
  model: 'inherit',
  color: 'cyan',
  effort: 'medium',
  background: false,
};

const DOCS_AGENT: BuiltInAgentDefinition = {
  agentType: 'Docs',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Documentation specialist for writing docs',
  whenToUse: 'Use this agent to write or update documentation, README files, or API docs.',
  disallowedTools: ['Agent', 'Bash', 'TaskCreate', 'TaskUpdate'],
  model: 'inherit',
  color: 'pink',
  effort: 'low',
  background: false,
};

const SECURITY_AGENT: BuiltInAgentDefinition = {
  agentType: 'Security',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Security specialist for vulnerability scanning',
  whenToUse: 'Use this agent to scan for security vulnerabilities, audit dependencies, or review code for security issues.',
  disallowedTools: ['Agent', 'Write'],
  model: 'inherit',
  color: 'red',
  effort: 'high',
  readOnly: true,
  background: false,
};

const PERF_AGENT: BuiltInAgentDefinition = {
  agentType: 'Performance',
  source: 'built-in',
  baseDir: 'built-in',
  description: 'Performance specialist for optimization',
  whenToUse: 'Use this agent to analyze performance, identify bottlenecks, or optimize code.',
  disallowedTools: ['Agent'],
  model: 'inherit',
  color: 'orange',
  effort: 'high',
  background: false,
};

export const EXTENDED_AGENTS: BuiltInAgentDefinition[] = [
  DEBUG_AGENT,
  REFACTOR_AGENT,
  TEST_AGENT,
  DOCS_AGENT,
  SECURITY_AGENT,
  PERF_AGENT,
];