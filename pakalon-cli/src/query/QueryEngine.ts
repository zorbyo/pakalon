/**
 * Query Engine - Core query processing system
 * Handles the main query loop, state machine, and recovery mechanisms
 */
import type { Tools } from '@/ai/tool-registry';
import type { Message, QuerySource } from '@/types/message';
import type { ToolUseContext } from '@/ai/tool-registry';
import logger from '@/utils/logger.js';
import { streamText, generateText, CoreMessage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

export interface QueryConfig {
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  querySource?: QuerySource;
}

export interface QueryContext {
  messages: CoreMessage[];
  systemPrompt?: string;
  userContext?: Record<string, string>;
  systemContext?: Record<string, string>;
  canUseTool?: (toolName: string) => boolean;
  toolUseContext?: ToolUseContext;
}

export interface QueryOptions extends QueryConfig {
  abortController?: AbortController;
  onProgress?: (progress: QueryProgress) => void;
  onError?: (error: Error) => void;
  onComplete?: (result: QueryResult) => void;
}

export interface QueryProgress {
  turn: number;
  phase: QueryPhase;
  status: 'running' | 'waiting' | 'complete' | 'error';
  message?: string;
}

export interface QueryResult {
  success: boolean;
  message?: string;
  finalMessage?: string;
  toolCalls?: Array<{ toolName: string; args: any }>;
  duration: number;
  tokensUsed?: number;
}

export type QueryPhase =
  | 'init'
  | 'planning'
  | 'execution'
  | 'compacting'
  | 'recovery'
  | 'complete'
  | 'error';

export interface QueryState {
  phase: QueryPhase;
  turn: number;
  maxTurns: number;
  messages: CoreMessage[];
  toolCallCount: number;
  tokenCount: number;
  lastError?: string;
  isAborted: boolean;
}

export class QueryEngine {
  private config: QueryConfig;
  private state: QueryState;
  private abortController: AbortController;
  private tools: Tools;

  constructor(config: QueryConfig, tools: Tools) {
    this.config = {
      maxTurns: 100,
      maxTokens: 4096,
      temperature: 0.7,
      model: 'anthropic/claude-3-5-sonnet',
      ...config,
    };

    this.tools = tools;
    this.abortController = new AbortController();

    this.state = {
      phase: 'init',
      turn: 0,
      maxTurns: this.config.maxTurns ?? 100,
      messages: [],
      toolCallCount: 0,
      tokenCount: 0,
      isAborted: false,
    };
  }

  async *query(
    context: QueryContext,
    options?: QueryOptions,
  ): AsyncGenerator<Message, void, void> {
    const abortController = options?.abortController ?? this.abortController;

    logger.info('[QueryEngine] Starting query');

    this.state.phase = 'planning';
    this.state.messages = [...context.messages];

    try {
      for await (const message of this.executeQueryLoop(context, abortController, options)) {
        yield message;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.info('[QueryEngine] Query aborted');
        this.state.isAborted = true;
      } else {
        logger.error(`[QueryEngine] Query error: ${error}`);
        this.state.phase = 'error';
        this.state.lastError = error instanceof Error ? error.message : String(error);
      }
    }

    this.state.phase = 'complete';
    logger.info('[QueryEngine] Query complete');
  }

  private async *executeQueryLoop(
    context: QueryContext,
    abortController: AbortController,
    options?: QueryOptions,
  ): AsyncGenerator<Message, void, void> {
    const model = this.config.model ?? 'anthropic/claude-3-5-sonnet';
    const maxTurns = this.state.maxTurns;

    while (this.state.turn < maxTurns && !this.state.isAborted) {
      if (abortController.signal.aborted) {
        break;
      }

      this.state.turn++;
      this.state.phase = 'execution';

      logger.debug(`[QueryEngine] Turn ${this.state.turn}/${maxTurns}`);

      try {
        const result = streamText({
          model: openrouter(model),
          system: context.systemPrompt,
          messages: this.state.messages,
          maxTokens: this.config.maxTokens ?? 4096,
          temperature: this.config.temperature ?? 0.7,
          tools: this.convertToolsToAIFormat(),
        });

        let accumulatedText = '';
        let hasToolCalls = false;

        for await (const textPart of result.textStream) {
          accumulatedText += textPart;
          yield this.createTextMessage(textPart, 'assistant');
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          hasToolCalls = true;

          for (const call of result.toolCalls) {
            this.state.toolCallCount++;
            yield this.createToolUseMessage(call.toolName, call.args as any);

            const toolResult = await this.executeTool(call.toolName, call.args as any, context);

            this.state.messages.push({
              role: 'assistant',
              content: accumulatedText,
            });

            this.state.messages.push({
              role: 'user',
              content: `Tool result: ${JSON.stringify(toolResult)}`,
            });

            yield this.createToolResultMessage(call.toolName, toolResult);
          }
        }

        if (!hasToolCalls && accumulatedText) {
          this.state.messages.push({
            role: 'assistant',
            content: accumulatedText,
          });
          break;
        }

        if (!hasToolCalls) {
          break;
        }
      } catch (error) {
        if (error instanceof Error) {
          if (this.isRetryableError(error)) {
            logger.warn(`[QueryEngine] Retryable error, attempting recovery: ${error.message}`);
            this.state.phase = 'recovery';
            continue;
          }
          throw error;
        }
      }
    }

    if (this.state.turn >= maxTurns) {
      logger.info('[QueryEngine] Max turns reached');
    }
  }

  private convertToolsToAIFormat(): Record<string, any> {
    const converted: Record<string, any> = {};

    for (const tool of this.tools) {
      if ('definition' in tool) {
        converted[tool.name] = {
          description: tool.definition.description,
          parameters: tool.definition.parameters,
        };
      }
    }

    return converted;
  }

  private async executeTool(
    toolName: string,
    args: any,
    context: QueryContext,
  ): Promise<any> {
    const tool = this.tools.find(t => t.name === toolName);

    if (!tool) {
      return { error: `Tool '${toolName}' not found` };
    }

    if (!context.canUseTool || !context.canUseTool(toolName)) {
      return { error: `Tool '${toolName}' not permitted` };
    }

    try {
      if ('handler' in tool) {
        return await tool.handler(args, context.toolUseContext);
      }
      return { error: 'Tool has no handler' };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      'rate limit',
      'timeout',
      'temporarily unavailable',
      'service overloaded',
    ];

    const message = error.message.toLowerCase();
    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  private createTextMessage(text: string, role: 'user' | 'assistant'): Message {
    return {
      type: role,
      uuid: this.generateUuid(),
      timestamp: new Date(),
      message: {
        role,
        content: [{ type: 'text', text }],
      },
    } as Message;
  }

  private createToolUseMessage(toolName: string, args: any): Message {
    return {
      type: 'assistant',
      uuid: this.generateUuid(),
      timestamp: new Date(),
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: this.generateUuid(),
            name: toolName,
            input: args,
          },
        ],
      },
    } as Message;
  }

  private createToolResultMessage(toolName: string, result: any): Message {
    return {
      type: 'user',
      uuid: this.generateUuid(),
      timestamp: new Date(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: this.generateUuid(),
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              },
            ],
          },
        ],
      },
    } as Message;
  }

  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  abort(): void {
    this.abortController.abort();
    this.state.isAborted = true;
  }

  getState(): QueryState {
    return { ...this.state };
  }

  getProgress(): QueryProgress {
    return {
      turn: this.state.turn,
      phase: this.state.phase,
      status: this.state.isAborted
        ? 'error'
        : this.state.phase === 'complete'
          ? 'complete'
          : 'running',
      message: this.state.lastError,
    };
  }
}

export async function createQueryEngine(
  config: QueryConfig,
  tools: Tools,
): Promise<QueryEngine> {
  return new QueryEngine(config, tools);
}

export { QueryEngine };
export type {
  QueryConfig,
  QueryContext,
  QueryOptions,
  QueryProgress,
  QueryResult,
  QueryState,
  QueryPhase,
};