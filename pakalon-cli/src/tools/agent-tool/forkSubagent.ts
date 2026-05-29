/**
 * Fork Subagent
 * Enables implicit forking of the current context to a sub-agent
 */
import { randomUUID } from 'crypto';
import type { AgentDefinition, Tools, AgentExecutionContext } from './types.js';
import { FORK_BOILERPLATE_TAG, FORK_DIRECTIVE_PREFIX } from './constants.js';
import { runAgent } from './runAgent.js';
import logger from '@/utils/logger.js';

interface ForkOptions {
  directive: string;
  context: AgentExecutionContext['context'];
  availableTools: Tools;
  parentMessages?: any[];
  worktreePath?: string;
  parentCwd?: string;
}

interface ForkResult {
  success: boolean;
  messages: any[];
  finalMessage: string;
  duration: number;
}

const FORK_PLACEHOLDER_RESULT = 'Fork started — processing in background';

export function isForkSubagentEnabled(): boolean {
  return process.env.FORK_SUBAGENT === 'true';
}

export function isInForkChild(messages: any[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user') return false;
    const content = m.message?.content;
    if (!Array.isArray(content)) return false;
    return content.some(
      (block: any) =>
        block.type === 'text' && block.text?.includes(`<${FORK_BOILERPLATE_TAG}>`),
    );
  });
}

export function buildForkedMessages(
  directive: string,
  assistantMessage: any,
): any[] {
  if (!assistantMessage || assistantMessage.type !== 'assistant') {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildChildMessage(directive),
          },
        ],
      },
    ];
  }

  const fullAssistantMessage = {
    ...assistantMessage,
    uuid: randomUUID(),
    message: {
      ...assistantMessage.message,
      content: [...(assistantMessage.message?.content ?? [])],
    },
  };

  const toolUseBlocks = (assistantMessage.message?.content ?? []).filter(
    (block: any) => block.type === 'tool_use',
  );

  if (toolUseBlocks.length === 0) {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildChildMessage(directive),
          },
        ],
      },
    ];
  }

  const toolResultBlocks = toolUseBlocks.map((block: any) => ({
    type: 'tool_result' as const,
    tool_use_id: block.id,
    content: [
      {
        type: 'text' as const,
        text: FORK_PLACEHOLDER_RESULT,
      },
    ],
  }));

  const toolResultMessage = {
    role: 'user' as const,
    content: [
      ...toolResultBlocks,
      {
        type: 'text' as const,
        text: buildChildMessage(directive),
      },
    ],
  };

  return [fullAssistantMessage, toolResultMessage];
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

export async function forkSubagent(options: ForkOptions): Promise<ForkResult> {
  const { directive, context, availableTools, parentMessages, worktreePath, parentCwd } =
    options;

  const startTime = Date.now();

  logger.info(`[forkSubagent] Forking with directive: ${directive.substring(0, 50)}...`);

  try {
    let forkMessages: any[] = [];

    if (parentMessages && parentMessages.length > 0) {
      const lastAssistantMessage = parentMessages.findLast(
        (m: any) => m.type === 'assistant',
      );

      if (lastAssistantMessage) {
        forkMessages = buildForkedMessages(directive, lastAssistantMessage);
      } else {
        forkMessages = [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildChildMessage(directive),
              },
            ],
          },
        ];
      }
    } else {
      forkMessages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildChildMessage(directive),
            },
          ],
        },
      ];
    }

    if (worktreePath && parentCwd) {
      const worktreeNotice = buildWorktreeNotice(parentCwd, worktreePath);
      forkMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: worktreeNotice,
          },
        ],
      });
    }

    const forkAgentDefinition: AgentDefinition = {
      agentType: 'fork',
      whenToUse: 'Implicit fork — inherits full conversation context.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['*'],
      maxTurns: 200,
      model: 'inherit',
      permissionMode: 'bubble',
      getSystemPrompt: () => '',
    };

    const result = await runAgent({
      agentDefinition: forkAgentDefinition,
      prompt: directive,
      context,
      availableTools,
      forkContextMessages: forkMessages,
    });

    const duration = Date.now() - startTime;
    logger.info(`[forkSubagent] Fork completed in ${duration}ms`);

    return {
      success: result.success,
      messages: forkMessages,
      finalMessage: result.finalMessage,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[forkSubagent] Error: ${errorMessage}`);

    return {
      success: false,
      messages: [],
      finalMessage: `Fork error: ${errorMessage}`,
      duration,
    };
  }
}

export async function* forkSubagentStreaming(
  options: ForkOptions,
): AsyncGenerator<string, ForkResult, void> {
  const { directive, context, availableTools, parentMessages, worktreePath, parentCwd } =
    options;

  const startTime = Date.now();

  logger.info(`[forkSubagentStreaming] Forking with directive: ${directive.substring(0, 50)}...`);

  try {
    let forkMessages: any[] = [];

    if (parentMessages && parentMessages.length > 0) {
      const lastAssistantMessage = parentMessages.findLast(
        (m: any) => m.type === 'assistant',
      );

      if (lastAssistantMessage) {
        forkMessages = buildForkedMessages(directive, lastAssistantMessage);
      }
    }

    if (!forkMessages.length) {
      forkMessages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildChildMessage(directive),
            },
          ],
        },
      ];
    }

    if (worktreePath && parentCwd) {
      const worktreeNotice = buildWorktreeNotice(parentCwd, worktreePath);
      forkMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: worktreeNotice,
          },
        ],
      });
    }

    const forkAgentDefinition: AgentDefinition = {
      agentType: 'fork',
      whenToUse: 'Implicit fork — inherits full conversation context.',
      source: 'built-in',
      baseDir: 'built-in',
      tools: ['*'],
      maxTurns: 200,
      model: 'inherit',
      permissionMode: 'bubble',
      getSystemPrompt: () => '',
    };

    const { runAgentStreaming } = await import('./runAgent.js');

    let fullMessage = '';

    for await (const textPart of runAgentStreaming({
      agentDefinition: forkAgentDefinition,
      prompt: directive,
      context,
      availableTools,
      forkContextMessages: forkMessages,
    })) {
      fullMessage += textPart;
      yield textPart;
    }

    const duration = Date.now() - startTime;
    logger.info(`[forkSubagentStreaming] Fork completed in ${duration}ms`);

    return {
      success: true,
      messages: forkMessages,
      finalMessage: fullMessage,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[forkSubagentStreaming] Error: ${errorMessage}`);

    return {
      success: false,
      messages: [],
      finalMessage: `Fork error: ${errorMessage}`,
      duration,
    };
  }
}

export { forkSubagent, forkSubagentStreaming };
export { buildForkedMessages, buildChildMessage, buildWorktreeNotice };
export { isForkSubagentEnabled, isInForkChild };