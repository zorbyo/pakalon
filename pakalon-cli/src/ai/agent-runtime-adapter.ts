/**
 * Agent Runtime Adapter
 * 
 * Bridges between existing BaseAgent system and new AgentRuntime.
 * Allows phase agents to use either system during migration.
 * 
 * This adapter enables gradual migration from BaseAgent to AgentRuntime
 * without breaking existing phase agents.
 */

import { AgentRuntime } from '@/ai/agent-runtime';
import { ToolRegistry } from '@/ai/tool-registry';
import type { AgentConfig as NewAgentConfig } from '@/ai/agent-runtime';
import type { AgentConfig as BaseAgentConfig, AgentContext } from '@/agents/types';
import logger from '@/utils/logger';

/**
 * Adapter options
 */
export interface AdapterOptions {
  /** Use new runtime (default: true) */
  useNewRuntime?: boolean;
  
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Agent Runtime Adapter
 * Provides a unified interface that works with both BaseAgent and AgentRuntime
 */
export class AgentRuntimeAdapter {
  private runtime: AgentRuntime;
  private toolRegistry: ToolRegistry;
  private options: AdapterOptions;
  
  constructor(options: AdapterOptions = {}) {
    this.options = {
      useNewRuntime: true,
      verbose: false,
      ...options,
    };
    
    this.toolRegistry = ToolRegistry.getInstance();
    this.runtime = new AgentRuntime(this.toolRegistry);
    
    if (this.options.verbose) {
      logger.info('[Adapter] Initialized with new runtime');
    }
  }
  
  /**
   * Convert BaseAgent config to new AgentRuntime config
   */
  private convertConfig(
    baseConfig: BaseAgentConfig,
    context: AgentContext
  ): NewAgentConfig {
    return {
      name: baseConfig.name,
      model: baseConfig.model,
      systemPrompt: baseConfig.systemPrompt,
      messages: [],
      maxSteps: 50,
      temperature: baseConfig.temperature,
      maxTokens: baseConfig.maxTokens,
    };
  }
  
  /**
   * Run an agent using the new runtime
   */
  async run(
    baseConfig: BaseAgentConfig,
    context: AgentContext,
    userMessage: string
  ): Promise<string> {
    if (!this.options.useNewRuntime) {
      throw new Error('BaseAgent execution not supported in adapter. Use BaseAgent directly.');
    }
    
    try {
      if (this.options.verbose) {
        logger.info(`[Adapter] Running agent: ${baseConfig.name}`);
      }
      
      // Convert config
      const newConfig = this.convertConfig(baseConfig, context);
      newConfig.messages = [{ role: 'user', content: userMessage }];
      
      // Hook up callbacks
      if (baseConfig.onToolCall) {
        // Tool calls will be tracked by runtime
      }
      
      if (baseConfig.onToolResult) {
        // Tool results will be tracked by runtime
      }
      
      // Run with new runtime
      const result = await this.runtime.run(newConfig);
      
      // Fire completion callback
      if (baseConfig.onComplete) {
        baseConfig.onComplete(result.finalMessage);
      }
      
      if (this.options.verbose) {
        logger.info(`[Adapter] Agent completed: ${result.toolCalls.length} tool calls`);
      }
      
      return result.finalMessage;
      
    } catch (error) {
      logger.error(`[Adapter] Agent failed:`, error);
      throw error;
    }
  }
  
  /**
   * Run agent in streaming mode
   */
  async *runStreaming(
    baseConfig: BaseAgentConfig,
    context: AgentContext,
    userMessage: string
  ): AsyncGenerator<string, void, unknown> {
    if (!this.options.useNewRuntime) {
      throw new Error('BaseAgent streaming not supported in adapter.');
    }
    
    try {
      if (this.options.verbose) {
        logger.info(`[Adapter] Streaming agent: ${baseConfig.name}`);
      }
      
      const newConfig = this.convertConfig(baseConfig, context);
      newConfig.messages = [{ role: 'user', content: userMessage }];
      
      // Stream responses
      const stream = this.runtime.runStreaming(newConfig);
      
      for await (const chunk of stream) {
        yield chunk;
      }
      
      if (this.options.verbose) {
        logger.info(`[Adapter] Streaming completed: ${baseConfig.name}`);
      }
      
    } catch (error) {
      logger.error(`[Adapter] Streaming failed:`, error);
      throw error;
    }
  }
  
  /**
   * Check if new runtime should be used
   */
  shouldUseNewRuntime(): boolean {
    return this.options.useNewRuntime ?? true;
  }
  
  /**
   * Get the underlying runtime
   */
  getRuntime(): AgentRuntime {
    return this.runtime;
  }
  
  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}

/**
 * Global adapter instance
 */
let globalAdapter: AgentRuntimeAdapter | null = null;

/**
 * Get or create global adapter
 */
export function getGlobalAdapter(options?: AdapterOptions): AgentRuntimeAdapter {
  if (!globalAdapter) {
    globalAdapter = new AgentRuntimeAdapter(options);
  }
  return globalAdapter;
}

/**
 * Helper to run phase agents with the new runtime
 */
export async function runPhaseAgent(
  agentName: string,
  config: BaseAgentConfig,
  context: AgentContext,
  userMessage: string
): Promise<string> {
  const adapter = getGlobalAdapter({ verbose: true });
  logger.info(`[Phase Agent] Starting ${agentName}...`);
  
  try {
    const result = await adapter.run(config, context, userMessage);
    logger.info(`[Phase Agent] ${agentName} completed successfully`);
    return result;
  } catch (error) {
    logger.error(`[Phase Agent] ${agentName} failed:`, error);
    throw error;
  }
}

export default AgentRuntimeAdapter;
