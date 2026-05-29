/**
 * SDK Query Function
 * Main query function for the SDK
 */
import { generateText, streamText, CoreMessage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import logger from '@/utils/logger.js';
import type { SDKConfig, QueryOptions, QueryResult, Message, Tool } from './coreTypes.js';

export async function query(options: QueryOptions): Promise<QueryResult> {
  const {
    messages,
    tools,
    model,
    maxTokens,
    temperature,
    systemPrompt,
  } = options;

  const config: Required<SDKConfig> = {
    apiKey: options.apiKey || '',
    baseUrl: options.baseUrl || 'https://openrouter.ai/api/v1',
    model: model || 'anthropic/claude-3-5-sonnet',
    maxTokens: maxTokens || 4096,
    temperature: temperature || 0.7,
    timeout: 60000,
    dangerouslyAllowBrowsing: true,
  };

  logger.info(`[SDK Query] Using model: ${config.model}`);

  try {
    const result = await generateText({
      model: openrouter(config.model),
      system: systemPrompt,
      messages,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      tools: tools ? convertTools(tools) : undefined,
    });

    const message: Message = {
      id: `msg_${Date.now()}`,
      role: 'assistant',
      content: result.text,
      createdAt: new Date().toISOString(),
    };

    return {
      message,
      usage: result.usage ? {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      } : undefined,
    };
  } catch (error) {
    logger.error(`[SDK Query] Error: ${error}`);
    throw error;
  }
}

export async function* queryStream(options: QueryOptions): AsyncGenerator<string, QueryResult, void> {
  const {
    messages,
    tools,
    model,
    maxTokens,
    temperature,
    systemPrompt,
  } = options;

  const config: Required<SDKConfig> = {
    apiKey: options.apiKey || '',
    baseUrl: options.baseUrl || 'https://openrouter.ai/api/v1',
    model: model || 'anthropic/claude-3-5-sonnet',
    maxTokens: maxTokens || 4096,
    temperature: temperature || 0.7,
    timeout: 60000,
    dangerouslyAllowBrowsing: true,
  };

  logger.info(`[SDK QueryStream] Using model: ${config.model}`);

  try {
    const result = streamText({
      model: openrouter(config.model),
      system: systemPrompt,
      messages,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      tools: tools ? convertTools(tools) : undefined,
    });

    let fullText = '';

    for await (const textPart of result.textStream) {
      fullText += textPart;
      yield textPart;
    }

    const message: Message = {
      id: `msg_${Date.now()}`,
      role: 'assistant',
      content: fullText,
      createdAt: new Date().toISOString(),
    };

    return {
      message,
      usage: result.usage ? {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      } : undefined,
    };
  } catch (error) {
    logger.error(`[SDK QueryStream] Error: ${error}`);
    throw error;
  }
}

function convertTools(tools: Tool[]): Record<string, any> {
  const converted: Record<string, any> = {};

  for (const tool of tools) {
    converted[tool.name] = {
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  return converted;
}

export type { QueryOptions, QueryResult };