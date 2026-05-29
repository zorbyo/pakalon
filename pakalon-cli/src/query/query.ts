/**
 * Query - Main query function and utilities
 * Entry point for the query engine
 */
import { generateText, streamText, CoreMessage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { Tools, ToolUseContext } from '@/ai/tool-registry';
import type { Message, QuerySource } from '@/types/message';
import logger from '@/utils/logger.js';

export interface QueryOptions {
  messages: CoreMessage[];
  systemPrompt?: string;
  userContext?: Record<string, string>;
  systemContext?: Record<string, string>;
  canUseTool?: (toolName: string) => boolean;
  toolUseContext?: ToolUseContext;
  querySource?: QuerySource;
  maxTurns?: number;
  model?: string;
  temperature?: number;
  abortController?: AbortController;
  tools?: Tools;
}

export interface QueryResult {
  text: string;
  toolCalls?: Array<{ toolName: string; args: any }>;
  finishReason: 'stop' | 'tool_use' | 'length' | 'content_filter' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
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

export async function query(options: QueryOptions): Promise<QueryResult> {
  const {
    messages,
    systemPrompt,
    maxTurns = 100,
    model = 'anthropic/claude-3-5-sonnet',
    temperature = 0.7,
    tools = [],
  } = options;

  logger.info('[query] Starting query');

  try {
    const result = await generateText({
      model: openrouter(model),
      system: systemPrompt,
      messages,
      maxTokens: 4096,
      temperature,
      tools: convertToolsToAIFormat(tools),
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls?.map(call => ({
        toolName: call.toolName,
        args: call.args as any,
      })),
      finishReason: 'stop',
      usage: result.usage
        ? {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          }
        : undefined,
    };
  } catch (error) {
    logger.error(`[query] Error: ${error}`);
    return {
      text: '',
      finishReason: 'error',
    };
  }
}

export async function* queryStream(
  options: QueryOptions,
): AsyncGenerator<string, QueryResult, void> {
  const {
    messages,
    systemPrompt,
    maxTurns = 100,
    model = 'anthropic/claude-3-5-sonnet',
    temperature = 0.7,
    tools = [],
  } = options;

  logger.info('[queryStream] Starting streaming query');

  const result = streamText({
    model: openrouter(model),
    system: systemPrompt,
    messages,
    maxTokens: 4096,
    temperature,
    tools: convertToolsToAIFormat(tools),
  });

  let fullText = '';

  try {
    for await (const textPart of result.textStream) {
      fullText += textPart;
      yield textPart;
    }
  } catch (error) {
    logger.error(`[queryStream] Error: ${error}`);
  }

  return {
    text: fullText,
    toolCalls: result.toolCalls?.map(call => ({
      toolName: call.toolName,
      args: call.args as any,
    })),
    finishReason: 'stop',
  };
}

export async function runQueryLoop(
  options: QueryOptions,
): Promise<{ finalMessage: string; toolCalls: Array<{ toolName: string; args: any }> }> {
  const { toolUseContext, canUseTool, tools = [] } = options;

  let messages = [...options.messages];
  let fullResponse = '';
  const allToolCalls: Array<{ toolName: string; args: any }> = [];

  const maxIterations = options.maxTurns ?? 100;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const result = await generateText({
      model: openrouter(options.model ?? 'anthropic/claude-3-5-sonnet'),
      system: options.systemPrompt,
      messages,
      maxTokens: 4096,
      temperature: options.temperature ?? 0.7,
      tools: convertToolsToAIFormat(tools),
    });

    fullResponse += result.text;

    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const call of result.toolCalls) {
        allToolCalls.push({
          toolName: call.toolName,
          args: call.args as any,
        });
      }

      messages.push({
        role: 'assistant',
        content: result.text || '',
      });

      for (const call of result.toolCalls) {
        const tool = tools.find(t => t.name === call.toolName);
        let toolResult: any = { error: 'Tool not found' };

        if (tool && 'handler' in tool) {
          try {
            toolResult = await tool.handler(call.args as any, toolUseContext);
          } catch (error) {
            toolResult = {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }

        messages.push({
          role: 'user',
          content: `Tool result: ${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)}`,
        });
      }
    } else {
      break;
    }
  }

  return {
    finalMessage: fullResponse,
    toolCalls: allToolCalls,
  };
}

export { query, queryStream, runQueryLoop };
export type { QueryOptions, QueryResult };