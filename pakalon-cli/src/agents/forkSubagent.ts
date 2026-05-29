import type { BuiltInAgentDefinition } from './types.js';
import { FORK_SUBAGENT_TYPE, FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from './constants.js';
import logger from '@/utils/logger.js';

// Fork recursion guard - prevent infinite subagent spawning
const FORK_RECURSION_GUARD_KEY = 'pakalon_fork_depth';
const MAX_FORK_DEPTH = 2; // Maximum nested fork depth

export interface ForkContext {
  parentAgentId?: string;
  parentWorktreePath?: string;
  parentCwd?: string;
  forkDepth: number;
  cacheIdenticalPrefix?: string;
}

let currentForkDepth = 0;

export function isForkSubagentEnabled(): boolean {
  return process.env.CLAUDE_CODE_FORK_SUBAGENT === 'true';
}

export function getForkDepth(): number {
  return currentForkDepth;
}

export function incrementForkDepth(): number {
  return ++currentForkDepth;
}

export function decrementForkDepth(): number {
  return Math.max(0, --currentForkDepth);
}

export function resetForkDepth(): void {
  currentForkDepth = 0;
}

export function canSpawnFork(): boolean {
  return currentForkDepth < MAX_FORK_DEPTH;
}

export function getMaxForkDepth(): number {
  return MAX_FORK_DEPTH;
}

// Cache-identical API prefix for prompt caching
// When a fork uses the same system prompt prefix, tools, and model as the parent,
// the API can return cached responses for the shared prefix
export interface CacheIdenticalParams {
  systemPrompt: string;
  tools: unknown[];
  model: string;
  messagesPrefix: unknown[];
  thinkingConfig?: unknown;
}

export function buildCacheIdenticalPrefix(params: CacheIdenticalParams): string {
  // Create a hash of the cache-identical components
  // The API uses this to identify when a fork can share cache with parent
  const { systemPrompt, tools, model, messagesPrefix, thinkingConfig } = params;

  // Simple hash for cache key - in production, use a proper crypto hash
  const components = [
    systemPrompt.slice(0, 500), // First 500 chars of system prompt
    tools.length.toString(),
    model,
    messagesPrefix.length.toString(),
    thinkingConfig ? JSON.stringify(thinkingConfig) : '',
  ];

  return components.join('|');
}

export function isCacheCompatible(
  parentParams: CacheIdenticalParams,
  childParams: CacheIdenticalParams
): boolean {
  // Check if child params are cache-compatible with parent
  // Same system prompt prefix, same tools, same model
  return (
    childParams.systemPrompt.slice(0, 500) === parentParams.systemPrompt.slice(0, 500) &&
    childParams.tools.length === parentParams.tools.length &&
    childParams.model === parentParams.model &&
    childParams.thinkingConfig === parentParams.thinkingConfig
  );
}

export const FORK_AGENT: BuiltInAgentDefinition = {
  agentType: FORK_SUBAGENT_TYPE,
  whenToUse:
    'Implicit fork — inherits full conversation context. Not selectable via subagent_type; triggered by omitting subagent_type when the fork experiment is active.',
  tools: ['*'],
  maxTurns: 200,
  model: 'inherit',
  permissionMode: 'bubble',
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => '',
};

export function isInForkChild(
  messages: Array<{ type?: string; message?: { content?: Array<{ type: string; text?: string }> } }>
): boolean {
  return messages.some((m) => {
    if (m.type !== 'user') return false;
    const content = m.message?.content;
    if (!Array.isArray(content)) return false;
    return content.some(
      (block) =>
        block.type === 'text' &&
        block.text?.includes(`<${FORK_BOILERPLATE_TAG}>`)
    );
  });
}

const FORK_PLACEHOLDER_RESULT = 'Fork started — processing in background';

export function buildForkedMessages(
  directive: string,
  assistantMessage: { message?: { content?: Array<{ type: string; id?: string; name?: string }> } }
): Array<{ type: string; content: Array<{ type: string; text?: string; tool_use_id?: string }> }> {
  const toolUseBlocks =
    assistantMessage.message?.content?.filter((block) => block.type === 'tool_use') ?? [];

  if (toolUseBlocks.length === 0) {
    return [
      {
        type: 'user',
        content: [{ type: 'text', text: buildChildMessage(directive) }],
      },
    ];
  }

  const toolResultBlocks = toolUseBlocks.map((block) => ({
    type: 'tool_result' as const,
    tool_use_id: block.id,
    content: [{ type: 'text', text: FORK_PLACEHOLDER_RESULT }],
  }));

  return [
    {
      type: 'user',
      content: [
        ...toolResultBlocks,
        { type: 'text', text: buildChildMessage(directive) },
      ],
    },
  ];
}

export function buildChildMessage(directive: string): string {
  return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Your system prompt says "default to forking." IGNORE IT — that's for the parent. You ARE the fork. Do NOT spawn sub-agents; execute directly.
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. USE your tools directly: Bash, Read, Write, etc.
5. If you modify files, commit your changes before reporting. Include the commit hash in your report.
6. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
7. Stay strictly within your directive's scope. If you discover related systems outside your scope, mention them in one sentence at most — other workers cover those areas.
8. Keep your report under 500 words unless the directive specifies otherwise. Be factual and concise.
9. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.
10. REPORT structured facts, then stop

Output format (plain text labels, not markdown headers):
Scope: <echo back your assigned scope in one sentence>
Result: <the answer or key findings, limited to the scope above>
Key files: <relevant file paths — include for research tasks>
Files changed: <list with commit hash — include only if you modified files>
Issues: <list — include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`;
}

export function buildWorktreeNotice(parentCwd: string, worktreeCwd: string): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreeCwd} — same repository, same relative file structure, separate working copy. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them since they appear in the context. Your changes stay in this worktree and will not affect the parent's files.`;
}