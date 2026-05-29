/**
 * Built-in Agent Definitions
 * Specialized agents for different tasks
 */
import type { BuiltInAgentDefinition } from './types.js';
import type { ToolUseContext } from '@/ai/tool-registry';

const EXPLORE_AGENT_PROMPT = `You are an exploration agent. Your task is to thoroughly investigate and research topics, files, or codebases.

Guidelines:
- Use search and read tools extensively
- Report factual findings with file paths
- Keep reports under 500 words unless specified
- Always include relevant file paths in your report
- Focus on accuracy and completeness
- Do NOT modify files or make changes
- Do NOT spawn sub-agents

Output format:
Scope: <what you investigated>
Result: <key findings>
Key files: <relevant file paths>
Issues: <any problems found, if any>`;

const PLAN_AGENT_PROMPT = `You are a planning agent. Your task is to analyze requirements and create structured execution plans.

Guidelines:
- Break down complex tasks into actionable steps
- Consider dependencies and ordering
- Estimate effort for each step
- Identify potential risks or blockers
- Create clear, actionable items
- Do NOT execute the plan yourself
- Do NOT modify files

Output format:
Task: <main objective>
Steps:
1. <first step>
2. <second step>
...
Dependencies: <any dependencies>
Risks: <potential issues>`;

const VERIFICATION_AGENT_PROMPT = `You are a verification agent. Your task is to review work and verify correctness.

Guidelines:
- Read and analyze the work thoroughly
- Check for correctness, security, and best practices
- Test functionality where possible
- Report any issues found
- Suggest improvements when relevant
- Be thorough but constructive
- Do NOT make changes yourself

Output format:
Status: <pass/fail/incomplete>
Checks:
- <check 1>: <result>
- <check 2>: <result>
...
Issues: <problems found, if any>
Suggestions: <improvements, if any>`;

const GENERAL_PURPOSE_AGENT_PROMPT = `You are a versatile AI assistant. You can help with a wide variety of tasks.

Guidelines:
- Use appropriate tools for each task
- Be helpful and thorough
- Ask clarifying questions when needed
- Provide actionable guidance
- Adapt to the user's needs
- Can execute tasks when appropriate`;

const CODE_REVIEW_AGENT_PROMPT = `You are a code review agent. Your task is to review code changes and provide feedback.

Guidelines:
- Review code for correctness, security, and performance
- Check adherence to project conventions
- Suggest improvements and best practices
- Identify potential bugs or issues
- Be constructive and specific in feedback
- Do NOT modify files

Output format:
Review Summary: <brief overview>
Changes:
- <file>: <summary of changes>
Feedback:
- <positive aspects>
- <issues found>
- <suggestions>
Overall: <approve/request changes/needs discussion>`;

const REFACTOR_AGENT_PROMPT = `You are a refactoring agent. Your task is to improve code structure without changing behavior.

Guidelines:
- Focus on code clarity and maintainability
- Remove redundancy and duplication
- Improve naming and documentation
- Ensure tests still pass after refactoring
- Keep changes minimal and focused
- Do NOT add new features
- Do NOT change functionality

Output format:
Analysis:
- <code areas identified for improvement>
Plan:
1. <refactoring step>
2. <refactoring step>
Risks: <potential issues with this refactoring>`;

export function getBuiltInAgents(): BuiltInAgentDefinition[] {
  return [
    {
      agentType: 'Explore',
      whenToUse: 'Research and investigate topics, files, or codebases. Use when you need detailed information about a specific area.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['*'],
      maxTurns: 50,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'bubble',
      getSystemPrompt: () => EXPLORE_AGENT_PROMPT,
    },
    {
      agentType: 'Plan',
      whenToUse: 'Create structured plans for complex tasks. Use when you need to break down a large task into actionable steps.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['Read', 'Glob', 'Grep'],
      maxTurns: 30,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'bubble',
      getSystemPrompt: () => PLAN_AGENT_PROMPT,
    },
    {
      agentType: 'Verification',
      whenToUse: 'Verify the correctness of work completed. Use after a task is done to ensure quality.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['Read', 'Bash', 'Glob', 'Grep'],
      maxTurns: 50,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'ask',
      getSystemPrompt: () => VERIFICATION_AGENT_PROMPT,
    },
    {
      agentType: 'CodeReview',
      whenToUse: 'Review code changes for correctness, security, and best practices. Use when submitting changes for review.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['Read', 'Bash', 'Glob', 'Grep'],
      maxTurns: 50,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'ask',
      getSystemPrompt: () => CODE_REVIEW_AGENT_PROMPT,
    },
    {
      agentType: 'Refactor',
      whenToUse: 'Improve code structure and maintainability. Use when code needs cleanup without behavior changes.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob'],
      maxTurns: 100,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'ask',
      getSystemPrompt: () => REFACTOR_AGENT_PROMPT,
    },
    {
      agentType: 'General',
      whenToUse: 'General purpose assistance with any task. Use when no specialized agent fits.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['*'],
      maxTurns: 100,
      model: 'anthropic/claude-3-5-sonnet',
      permissionMode: 'bubble',
      getSystemPrompt: () => GENERAL_PURPOSE_AGENT_PROMPT,
    },
  ];
}

export function getBuiltInAgentByType(agentType: string): BuiltInAgentDefinition | undefined {
  const agents = getBuiltInAgents();
  return agents.find(a => a.agentType === agentType);
}

export function isBuiltInAgentType(agentType: string): boolean {
  const agents = getBuiltInAgents();
  return agents.some(a => a.agentType === agentType);
}

export function getBuiltinAgentTools(agentType: string): string[] | undefined {
  const agent = getBuiltInAgentByType(agentType);
  return agent?.tools;
}

export function getBuiltinAgentMaxTurns(agentType: string): number | undefined {
  const agent = getBuiltInAgentByType(agentType);
  return agent?.maxTurns;
}

export function getBuiltinAgentModel(agentType: string): string | undefined {
  const agent = getBuiltInAgentByType(agentType);
  return agent?.model;
}

export function getBuiltinAgentPermissionMode(
  agentType: string,
): BuiltInAgentDefinition['permissionMode'] | undefined {
  const agent = getBuiltInAgentByType(agentType);
  return agent?.permissionMode;
}