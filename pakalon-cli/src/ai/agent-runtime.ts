/**
 * TypeScript Agent Runtime - Core orchestration engine
 * 
 * Replaces Python LangGraph with pure TypeScript agent system.
 * Implements Copilot CLI-style agent execution with:
 * - LLM streaming with Vercel AI SDK
 * - Tool calling loop (LLM → Tool → LLM)
 * - Context management and token tracking
 * - Permission gating for tools
 * - Fleet/parallel agent support
 * 
 * This is the heart of Pakalon's migration from Python to TypeScript.
 */

import { openrouter } from '@openrouter/ai-sdk-provider';
import { streamText, type CoreMessage, type CoreTool } from 'ai';
import { ToolRegistry, type ToolCall, type ToolResult } from './tool-registry';
import { PermissionGate, type PermissionMode } from './tool-permissions';
import { AgentStateTracker } from './agent-state';
import { SteeringManager } from './steering';
import { ModelSwitcher } from './model-switcher';
import { ToolExecutionModeManager, type ToolCallInfo, type ToolExecutionResult } from './tool-execution-mode';
import logger from '@/utils/logger';

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Model to use (e.g., 'anthropic/claude-3.5-sonnet') */
  model: string;
  
  /** Maximum tokens in context window */
  maxTokens?: number;
  
  /** Maximum tool call steps before stopping */
  maxSteps?: number;
  
  /** Allowed tools (empty = all) */
  allowedTools?: string[];
  
  /** Denied tools */
  deniedTools?: string[];
  
  /** Allow all tools without prompts */
  allowAll?: boolean;
  
  /** Permission mode */
  mode?: PermissionMode;
  
  /** System prompt */
  systemPrompt?: string;
  
  /** Streaming callback */
  onStream?: (chunk: string) => void;
  
  /** Tool call callback */
  onToolCall?: (toolCall: ToolCall) => void;
  
  /** Tool result callback */
  onToolResult?: (toolCall: ToolCall, result: ToolResult) => void;
  
  /** Finish callback */
  onFinish?: (result: AgentResult) => void;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  /** Final text response from agent */
  finalResponse: string;
  
  /** Number of tool calls executed */
  toolCallsExecuted: number;
  
  /** Total tokens used */
  tokensUsed: number;
  
  /** Execution duration in ms */
  duration: number;
  
  /** Finish reason */
  finishReason: string;
  
  /** All messages in conversation */
  messages: CoreMessage[];
}

/**
 * Agent Runtime
 * 
 * Core agent orchestration engine that replaces Python LangGraph.
 */
export class AgentRuntime {
  private config: AgentConfig;
  private tools: ToolRegistry;
  private permissions: PermissionGate;
  private messages: CoreMessage[] = [];
  private tokensUsed = 0;
  private state: AgentStateTracker;
  private steering: SteeringManager;
  private modelSwitcher: ModelSwitcher;
  private execMode: ToolExecutionModeManager;

  constructor(config: AgentConfig, toolRegistry?: ToolRegistry) {
    this.config = {
      maxTokens: 128000,
      maxSteps: 50,
      mode: 'interactive',
      ...config,
    };

    this.tools = toolRegistry || new ToolRegistry();
    this.state = new AgentStateTracker();
    this.steering = new SteeringManager();
    this.modelSwitcher = new ModelSwitcher(config.model);
    this.execMode = new ToolExecutionModeManager();
    this.permissions = new PermissionGate({
      allowedTools: config.allowedTools,
      deniedTools: config.deniedTools,
      allowAll: config.allowAll,
      mode: config.mode,
    });

    // Add system prompt if provided
    if (config.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: config.systemPrompt,
      });
    }
  }

  /**
   * Run agent with a prompt
   */
  async run(prompt: string | CoreMessage[]): Promise<AgentResult> {
    const startTime = Date.now();
    let toolCallCount = 0;
    let finalResponse = '';

    // Add user prompt to messages
    if (typeof prompt === 'string') {
      this.messages.push({ role: 'user', content: prompt });
    } else {
      this.messages.push(...prompt);
    }

    // Main agent loop
    let continueLoop = true;
    let currentStep = 0;

    while (continueLoop && currentStep < this.config.maxSteps!) {
      currentStep++;

      // Check for steering/interruption follow-ups
      if (this.steering.isTurnInterrupted()) {
        const followUp = this.steering.getPendingFollowUp();
        if (followUp) {
          this.steering.acknowledgeInterruption();
          this.messages.push({ role: 'user', content: followUp.text });
          logger.info('[AgentRuntime] Processing steering follow-up', { text: followUp.text.slice(0, 100) });
        }
      }

      try {
        // Set state to thinking before LLM call
        this.state.setState('thinking', 'Starting LLM call');

        // Use ModelSwitcher for current model
        const currentModelId = this.modelSwitcher.getModelId();

        const result = await streamText({
          model: openrouter(currentModelId),
          messages: this.messages,
          tools: this.tools.getToolDefinitions(),
          maxSteps: 1, // Process one step at a time for better control
          onChunk: ({ chunk }) => {
            if (this.config.onStream && chunk.type === 'text-delta') {
              this.config.onStream(chunk.textDelta);
            }
          },
        });

        // Process the stream — collect all tool calls and text
        let hasToolCalls = false;
        const collectedCalls: Array<{
          toolCall: ToolCall;
          toolCallId: string;
          toolName: string;
          args: Record<string, unknown>;
        }> = [];

        for await (const part of result.fullStream) {
          if (part.type === 'tool-call') {
            hasToolCalls = true;
            const toolCall: ToolCall = {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.args,
            };
            collectedCalls.push({ toolCall, toolCallId: part.toolCallId, toolName: part.toolName, args: part.args as Record<string, unknown> });

            // Callback
            if (this.config.onToolCall) {
              this.config.onToolCall(toolCall);
            }
          }

          if (part.type === 'text-delta') {
            finalResponse += part.textDelta;
          }

          if (part.type === 'finish') {
            // Check if we should continue
            if (
              part.finishReason === 'stop' ||
              part.finishReason === 'end' ||
              part.finishReason === 'max-steps'
            ) {
              continueLoop = false;
            }
          }
        }

        // Execute tools using ToolExecutionModeManager
        if (hasToolCalls) {
          // Check permissions first for all tools
          const permissionResults = new Map<string, boolean>();
          for (const { toolCall } of collectedCalls) {
            this.state.setState('waiting_permission', `Permission for ${toolCall.toolName}`);
            this.state.setCurrentTool(toolCall.toolName);

            const allowed = await this.permissions.checkPermission(
              toolCall.toolName,
              toolCall.args
            );

            if (!allowed) {
              logger.warn(`Tool ${toolCall.toolName} denied by user`);
              this.messages.push({
                role: 'tool',
                content: [{
                  type: 'tool-result',
                  toolCallId: toolCall.toolCallId,
                  result: { error: 'Permission denied by user' },
                }],
              });
            }
            permissionResults.set(toolCall.toolCallId, allowed);
          }

          // Execute permitted tools via ToolExecutionModeManager
          const permittedCalls = collectedCalls.filter(c => permissionResults.get(c.toolCallId));
          if (permittedCalls.length > 0) {
            this.state.setState('executing_tool', `Executing ${permittedCalls.length} tool(s)`);

            const toolCallInfos: ToolCallInfo[] = permittedCalls.map(c => ({
              id: c.toolCallId,
              name: c.toolName,
              args: c.args,
            }));

            const toolResults = await this.execMode.execute(
              toolCallInfos,
              async (info: ToolCallInfo): Promise<ToolExecutionResult> => {
                const start = Date.now();
                try {
                  const tc = permittedCalls.find(c => c.toolCallId === info.id)!;
                  const result = await this.tools.execute(tc.toolCall);
                  toolCallCount++;

                  // Callback
                  if (this.config.onToolResult) {
                    this.config.onToolResult(tc.toolCall, result);
                  }

                  return {
                    id: info.id,
                    name: info.name,
                    success: result.success,
                    output: result.output,
                    error: result.error,
                    duration: Date.now() - start,
                  };
                } catch (err) {
                  return {
                    id: info.id,
                    name: info.name,
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                    duration: Date.now() - start,
                  };
                }
              },
            );

            // Add results to messages
            for (let i = 0; i < permittedCalls.length; i++) {
              const c = permittedCalls[i]!;
              const tr = toolResults[i];
              this.messages.push({
                role: 'tool',
                content: [{
                  type: 'tool-result',
                  toolCallId: c.toolCallId,
                  result: tr?.success ? tr.output : { error: tr?.error ?? 'Unknown error' },
                }],
              });
            }
          }
        } else {
          // No tool calls — we're done with this turn
          continueLoop = false;
        }

        // Add assistant message if we got text
        if (finalResponse.trim()) {
          this.messages.push({
            role: 'assistant',
            content: finalResponse,
          });
        }

      } catch (error) {
        this.state.setState('error', `Runtime error: ${error instanceof Error ? error.message : String(error)}`);
        logger.error('Agent runtime error:', error);
        continueLoop = false;
        finalResponse += `\n\nError: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Set state to idle when done
    this.state.setState('idle', 'Agent run completed');
    this.state.setCurrentTool(undefined);

    const duration = Date.now() - startTime;

    const result: AgentResult = {
      finalResponse,
      toolCallsExecuted: toolCallCount,
      tokensUsed: this.estimateTokens(),
      duration,
      finishReason: currentStep >= this.config.maxSteps! ? 'max-steps' : 'stop',
      messages: this.messages,
    };

    // Callback
    if (this.config.onFinish) {
      this.config.onFinish(result);
    }

    return result;
  }

  /**
   * Run fleet of agents in parallel
   */
  async runFleet(
    task: string,
    models: string[]
  ): Promise<AgentResult[]> {
    logger.info(`Running fleet with ${models.length} models...`);

    const agents = models.map(
      (model) =>
        new AgentRuntime({
          ...this.config,
          model,
          mode: 'autonomous', // Fleet runs autonomously
          allowAll: true, // No prompts in fleet mode
        }, this.tools)
    );

    const results = await Promise.all(
      agents.map((agent, i) => {
        logger.info(`Fleet agent ${i + 1}/${models.length} starting (${models[i]})`);
        return agent.run(task);
      })
    );

    logger.info(`Fleet completed with ${results.length} results`);
    return results;
  }

  /**
   * Add a message to the conversation
   */
  addMessage(message: CoreMessage): void {
    this.messages.push(message);
  }

  /**
   * Get current messages
   */
  getMessages(): CoreMessage[] {
    return this.messages;
  }

  /**
   * Clear messages (new conversation)
   */
  clearMessages(): void {
    const systemMessages = this.messages.filter((m) => m.role === 'system');
    this.messages = systemMessages;
  }

  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.tools;
  }

  /**
   * Get permission gate
   */
  getPermissions(): PermissionGate {
    return this.permissions;
  }

  /**
   * Get agent state tracker
   */
  getState(): AgentStateTracker {
    return this.state;
  }

  /**
   * Get the steering manager (for follow-up/interruption handling).
   */
  getSteering(): SteeringManager {
    return this.steering;
  }

  /**
   * Get the model switcher (for runtime model changes).
   */
  getModelSwitcher(): ModelSwitcher {
    return this.modelSwitcher;
  }

  /**
   * Get the tool execution mode manager.
   */
  getExecMode(): ToolExecutionModeManager {
    return this.execMode;
  }

  /**
   * Estimate tokens used (rough approximation)
   */
  private estimateTokens(): number {
    const content = JSON.stringify(this.messages);
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(content.length / 4);
  }

  /**
   * Get runtime statistics
   */
  getStats() {
    return {
      messagesCount: this.messages.length,
      tokensUsed: this.estimateTokens(),
      toolsAvailable: this.tools.listTools().length,
      permissionMode: this.permissions.getMode(),
    };
  }
}

/**
 * Create agent runtime from CLI configuration
 */
export function createAgentRuntimeFromConfig(config: {
  model?: string;
  allowTool?: string[];
  denyTool?: string[];
  allowAll?: boolean;
  yolo?: boolean;
  systemPrompt?: string;
  maxSteps?: number;
}): AgentRuntime {
  return new AgentRuntime({
    model: config.model || 'anthropic/claude-3.5-sonnet',
    allowedTools: config.allowTool,
    deniedTools: config.denyTool,
    allowAll: config.allowAll || config.yolo,
    mode: config.yolo ? 'yolo' : 'interactive',
    systemPrompt: config.systemPrompt,
    maxSteps: config.maxSteps,
  });
}
