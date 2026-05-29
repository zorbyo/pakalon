/**
 * Base Agent Class - Foundation for all 6-phase agents
 * Uses Vercel AI SDK for LLM orchestration
 */
import { generateText, streamText, CoreMessage } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';
import type { AgentConfig, AgentContext, AgentResult, ToolCallEvent, ToolResultEvent } from './types.js';
import logger from '@/utils/logger.js';

export class BaseAgent {
  protected config: AgentConfig;
  protected context: AgentContext;
  protected conversationHistory: CoreMessage[] = [];
  protected toolCallHistory: ToolCallEvent[] = [];
  protected toolResultHistory: ToolResultEvent[] = [];
  
  constructor(config: AgentConfig, context: AgentContext) {
    this.config = config;
    this.context = context;
    
    logger.info(`[${this.config.name}] Agent initialized`);
    logger.debug(`[${this.config.name}] Model: ${this.config.model}`);
    logger.debug(`[${this.config.name}] Project: ${this.context.projectDir}`);
    logger.debug(`[${this.config.name}] YOLO mode: ${this.context.isYolo}`);
  }
  
  /**
   * Run agent with a single prompt (non-streaming)
   */
async run(userMessage: string): Promise<string> {
    const startTime = Date.now();
    const toolCallTimes = new Map<string, number>();
    
    try {
      logger.info(`[${this.config.name}] Starting agent run...`);
      
const result = await generateText({
        model: openrouter(this.config.model),
        system: this.config.systemPrompt,
        prompt: userMessage,
        tools: this.config.tools as never,
        temperature: this.config.temperature || 0.7,
        maxOutputTokens: this.config.maxTokens || 4096,
        
        // Tool call handling
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          // Log tool calls and track timing
          if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach((call: any) => {
              const callTime = Date.now();
              toolCallTimes.set(call.toolName, callTime);
              
              const event: ToolCallEvent = {
                toolName: call.toolName,
                args: call.args,
                timestamp: new Date(),
              };
              this.toolCallHistory.push(event);
              
              logger.info(`[${this.config.name}] [Wrench] Tool call: ${call.toolName}`);
              logger.debug(`[${this.config.name}] Args: ${JSON.stringify(call.args, null, 2)}`);
              
              this.config.onToolCall?.(call.toolName, call.args);
            });
          }
          
          // Log tool results with duration calculation
          if (toolResults && toolResults.length > 0) {
            toolResults.forEach((result: any) => {
              const callTime = toolCallTimes.get(result.toolName);
              const duration = callTime ? Date.now() - callTime : 0;
              
              const event: ToolResultEvent = {
                toolName: result.toolName,
                result: result.result,
                success: !result.error,
                error: result.error,
                timestamp: new Date(),
                duration,
              };
              this.toolResultHistory.push(event);
              
              if (result.error) {
                logger.error(`[${this.config.name}] [X] Tool error: ${result.toolName} - ${result.error} (${duration}ms)`);
              } else {
                logger.info(`[${this.config.name}] [OK] Tool result: ${result.toolName} (${duration}ms)`);
              }
              
              this.config.onToolResult?.(result.toolName, result.result);
            });
          }
          
          // Log text output
          if (text) {
            logger.debug(`[${this.config.name}] Text: ${text.substring(0, 100)}...`);
          }
        },
      });
      
      const duration = Date.now() - startTime;
      
      logger.info(`[${this.config.name}] Agent run completed in ${duration}ms`);
      logger.debug(`[${this.config.name}] Tool calls: ${this.toolCallHistory.length}`);
      logger.debug(`[${this.config.name}] Tokens used: ${result.usage?.totalTokens || 'unknown'}`);
      
      this.config.onComplete?.(result.text);
      
      return result.text;
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      
      logger.error(`[${this.config.name}] Agent run failed after ${duration}ms: ${message}`);
      
      throw error;
    }
  }
  
  /**
   * Run agent with streaming output
   */
  async *runStreaming(userMessage: string): AsyncGenerator<string> {
    const startTime = Date.now();
    
    try {
      logger.info(`[${this.config.name}] Starting streaming agent run...`);
      
const result = streamText({
        model: openrouter(this.config.model),
        system: this.config.systemPrompt,
        prompt: userMessage,
        tools: this.config.tools as never,
        temperature: this.config.temperature || 0.7,
        maxOutputTokens: this.config.maxTokens || 4096,
        
        // Tool call handling
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          // Same tool logging as run()
          if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach((call: any) => {
              const event: ToolCallEvent = {
                toolName: call.toolName,
                args: call.args,
                timestamp: new Date(),
              };
              this.toolCallHistory.push(event);
              
              logger.info(`[${this.config.name}] [Wrench] Tool call: ${call.toolName}`);
              this.config.onToolCall?.(call.toolName, call.args);
            });
          }
          
          if (toolResults && toolResults.length > 0) {
            toolResults.forEach((result: any) => {
              const event: ToolResultEvent = {
                toolName: result.toolName,
                result: result.result,
                success: !result.error,
                error: result.error,
                timestamp: new Date(),
                duration: 0,
              };
              this.toolResultHistory.push(event);
              
              logger.info(`[${this.config.name}] ${result.error ? '[X]' : '[OK]'} Tool result: ${result.toolName}`);
              this.config.onToolResult?.(result.toolName, result.result);
            });
          }
        },
      });
      
      // Stream text deltas
      for await (const textPart of result.textStream) {
        this.config.onTextDelta?.(textPart);
        yield textPart;
      }
      
      const duration = Date.now() - startTime;
      logger.info(`[${this.config.name}] Streaming completed in ${duration}ms`);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      
      logger.error(`[${this.config.name}] Streaming failed after ${duration}ms: ${message}`);
      
      throw error;
    }
  }
  
  /**
   * Add a message to conversation history
   */
  protected addMessage(role: 'user' | 'assistant' | 'system', content: string) {
    this.conversationHistory.push({
      role,
      content,
    });
  }
  
  /**
   * Get tool call statistics
   */
  public getToolStats() {
    const toolCounts = new Map<string, number>();
    
    this.toolCallHistory.forEach(call => {
      toolCounts.set(call.toolName, (toolCounts.get(call.toolName) || 0) + 1);
    });
    
    return {
      totalCalls: this.toolCallHistory.length,
      toolCounts: Object.fromEntries(toolCounts),
      successCount: this.toolResultHistory.filter(r => r.success).length,
      errorCount: this.toolResultHistory.filter(r => !r.success).length,
    };
  }
  
  /**
   * Clear history (for memory management)
   */
  public clearHistory() {
    this.conversationHistory = [];
    this.toolCallHistory = [];
    this.toolResultHistory = [];
    
    logger.debug(`[${this.config.name}] History cleared`);
  }
  
  /**
   * Execute the agent's main task (to be overridden by subclasses)
   */
  public async execute(): Promise<AgentResult> {
    throw new Error(`Agent ${this.config.name} must implement execute() method`);
  }
}
