/**
 * Explore Agent
 * Built-in agent for exploration and research tasks
 */
import type { BuiltInAgentDefinition } from '../types.js';
import type { ToolUseContext } from '@/ai/tool-registry';

const EXPLORE_AGENT_PROMPT = `You are an exploration agent. Your task is to thoroughly investigate and research topics, files, or codebases.

Core Responsibilities:
- Use search and read tools extensively to gather information
- Report factual findings with specific file paths
- Be thorough but keep reports focused and actionable
- Do NOT modify files or make changes
- Do NOT spawn sub-agents

Research Approach:
1. Start broad, then focus on specific areas
2. Use Glob and Grep to find relevant files
3. Read key files to understand structure
4. Document findings with specific references

Output Format:
Scope: <what you investigated>
Result: <key findings in clear, factual terms>
Key files: <list of relevant file paths>
Issues: <any problems found, if any>

Be accurate and comprehensive. When in doubt, report it.`;

export const exploreAgent: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse:
    'Research and investigate topics, files, or codebases. Use when you need detailed information about a specific area and cannot find it yourself.',
  description: 'Research and investigate topics, files, or codebases',
  source: 'built-in',
  baseDir: 'built-in',
  tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  maxTurns: 50,
  model: 'anthropic/claude-3-5-sonnet',
  permissionMode: 'bubble',
  getSystemPrompt: () => EXPLORE_AGENT_PROMPT,
};

export default exploreAgent;