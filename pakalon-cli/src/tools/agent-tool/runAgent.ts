/**
 * Run Agent
 * Executes a sub-agent with the given prompt and configuration
 */
import type { AgentDefinition, AgentExecutionContext, Tools } from './types.js';
import { resolveAgentTools } from './agentToolUtils.js';
import { getBuiltInAgentByType } from './builtInAgents.js';
import { getAgentColor } from './agentColorManager.js';
import logger from '@/utils/logger.js';
import { generateText, streamText, CoreMessage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

interface RunAgentOptions {
  agentDefinition?: AgentDefinition;
  prompt: string;
  model?: string;
  maxTurns?: number;
  context: AgentExecutionContext['context'];
  availableTools: Tools;
  isAsync?: boolean;
  forkContextMessages?: any[];
}

interface AgentResult {
  success: boolean;
  finalMessage: string;
  toolCalls: Array<{ toolName: string; args: any }>;
  duration: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    isAsync = false,
    forkContextMessages,
  } = options;

  const startTime = Date.now();

  logger.info(`[runAgent] Starting agent: ${agentDefinition?.agentType ?? 'fork'}`);

  try {
    let systemPrompt: string;
    let resolvedModel: string;
    let resolvedMaxTurns: number;
    let resolvedTools: Tools;

    if (agentDefinition) {
      systemPrompt =
        'getSystemPrompt' in agentDefinition
          ? agentDefinition.getSystemPrompt({ toolUseContext: { options: context.options } })
          : '';

      resolvedModel =
        model || agentDefinition.model || 'anthropic/claude-3-5-sonnet';

      resolvedMaxTurns = maxTurns ?? agentDefinition.maxTurns ?? 50;

      const resolved = resolveAgentTools(
        agentDefinition,
        availableTools,
        isAsync,
      );
      resolvedTools = resolved.resolvedTools;
    } else {
      systemPrompt = 'You are a helpful AI assistant.';
      resolvedModel = model || 'anthropic/claude-3-5-sonnet';
      resolvedMaxTurns = maxTurns ?? 50;
      resolvedTools = availableTools;
    }

    const color = getAgentColor(agentDefinition?.agentType ?? 'fork');
    logger.debug(`[runAgent] Using model: ${resolvedModel}, maxTurns: ${resolvedMaxTurns}`);

    const messages: CoreMessage[] = [];

    if (forkContextMessages && forkContextMessages.length > 0) {
      messages.push(...forkContextMessages);
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    let finalMessage = '';
    const toolCalls: Array<{ toolName: string; args: any }> = [];

    if (isAsync) {
      const result = await generateText({
        model: openrouter(resolvedModel),
        system: systemPrompt,
        messages,
        maxTokens: 4096,
        temperature: 0.7,
        tools: convertToolsToAIFormat(resolvedTools),
      });

      finalMessage = result.text;
    } else {
      for (let turn = 0; turn < resolvedMaxTurns; turn++) {
        const result = await generateText({
          model: openrouter(resolvedModel),
          system: systemPrompt,
          messages,
          maxTokens: 4096,
          temperature: 0.7,
          tools: convertToolsToAIFormat(resolvedTools),
        });

        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const call of result.toolCalls) {
            toolCalls.push({
              toolName: call.toolName,
              args: call.args as any,
            });
          }
        }

        if (result.text) {
          finalMessage = result.text;
        }

        if (!result.toolCalls || result.toolCalls.length === 0) {
          break;
        }

        const toolResults = await executeToolCalls(
          result.toolCalls,
          resolvedTools,
          context,
        );

        messages.push({
          role: 'assistant',
          content: result.text || '',
        });

        for (const result2 of toolResults) {
          messages.push({
            role: 'user',
            content: result2.content,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[runAgent] Agent completed in ${duration}ms`);

    return {
      success: true,
      finalMessage,
      toolCalls,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[runAgent] Error: ${errorMessage}`);

    return {
      success: false,
      finalMessage: `Error: ${errorMessage}`,
      toolCalls: [],
      duration,
    };
  }
}

function convertToolsToAIFormat(tools: Tools): Record<string, any> {
  const converted: Record<string, any> = {};

  for (const tool of tools) {
    if ('definition' in tool) {
      converted[tool.name] = {
        description: tool.definition.description,
        parameters: tool.definition.parameters,
      };
    }
  }

  return converted;
}

async function executeToolCalls(
  toolCalls: Array<{ toolName: string; args: any }>,
  availableTools: Tools,
  context: AgentExecutionContext['context'],
): Promise<Array<{ role: string; content: string }>> {
  const results: Array<{ role: string; content: string }> = [];

  for (const call of toolCalls) {
    const tool = availableTools.find(t => t.name === call.toolName);

    if (!tool) {
      results.push({
        role: 'user',
        content: `Error: Tool '${call.toolName}' not found`,
      });
      continue;
    }

    try {
      let result: any;
      if ('handler' in tool) {
        result = await tool.handler(call.args, context);
      } else {
        result = { error: 'Tool has no handler' };
      }

      const resultContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      results.push({
        role: 'user',
        content: `Result: ${resultContent}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        role: 'user',
        content: `Error: ${errorMessage}`,
      });
    }
  }

  return results;
}

export async function* runAgentStreaming(
  options: RunAgentOptions,
): AsyncGenerator<string, AgentResult, void> {
  const {
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    forkContextMessages,
  } = options;

  const startTime = Date.now();

  logger.info(`[runAgentStreaming] Starting agent: ${agentDefinition?.agentType ?? 'fork'}`);

  try {
    let systemPrompt: string;
    let resolvedModel: string;
    let resolvedMaxTurns: number;
    let resolvedTools: Tools;

    if (agentDefinition) {
      systemPrompt =
        'getSystemPrompt' in agentDefinition
          ? agentDefinition.getSystemPrompt({ toolUseContext: { options: context.options } })
          : '';

      resolvedModel =
        model || agentDefinition.model || 'anthropic/claude-3-5-sonnet';

      resolvedMaxTurns = maxTurns ?? agentDefinition.maxTurns ?? 50;

      const resolved = resolveAgentTools(
        agentDefinition,
        availableTools,
        false,
      );
      resolvedTools = resolved.resolvedTools;
    } else {
      systemPrompt = 'You are a helpful AI assistant.';
      resolvedModel = model || 'anthropic/claude-3-5-sonnet';
      resolvedMaxTurns = maxTurns ?? 50;
      resolvedTools = availableTools;
    }

    const messages: CoreMessage[] = [];

    if (forkContextMessages && forkContextMessages.length > 0) {
      messages.push(...forkContextMessages);
    }

    messages.push({
      role: 'user',
      content: prompt,
    });

    const result = streamText({
      model: openrouter(resolvedModel),
      system: systemPrompt,
      messages,
      maxTokens: 4096,
      temperature: 0.7,
      tools: convertToolsToAIFormat(resolvedTools),
    });

    let finalMessage = '';
    const toolCalls: Array<{ toolName: string; args: any }> = [];

    for await (const textPart of result.textStream) {
      finalMessage += textPart;
      yield textPart;
    }

    const duration = Date.now() - startTime;
    logger.info(`[runAgentStreaming] Agent completed in ${duration}ms`);

    return {
      success: true,
      finalMessage,
      toolCalls,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[runAgentStreaming] Error: ${errorMessage}`);

    return {
      success: false,
      finalMessage: `Error: ${errorMessage}`,
      toolCalls: [],
      duration,
    };
  }
}

export { runAgent, runAgentStreaming };
export type { AgentResult, RunAgentOptions };