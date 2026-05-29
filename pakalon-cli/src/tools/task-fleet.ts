/**
 * Task/Fleet Delegation Tool (Copilot CLI style)
 * 
 * Allows agents to delegate sub-tasks to other agents or run tasks in fleet mode.
 * This enables hierarchical task decomposition and parallel execution.
 * 
 * Similar to Copilot CLI's task tool for spawning sub-agents.
 * 
 * Features:
 * - Single task delegation to sub-agent
 * - Fleet execution for parallel tasks
 * - Result aggregation
 * - Timeout protection
 */

import { z } from 'zod';
import { AgentRuntime } from '@/ai/agent-runtime';
import { FleetOrchestrator } from '@/ai/fleet';
import { ToolRegistry } from '@/ai/tool-registry';
import type { ToolDefinition } from '@/ai/tool-registry';

/**
 * Task delegation tool - Run a sub-task with a new agent
 */
const taskTool: ToolDefinition = {
  name: 'task',
  definition: {
    description: `Delegate a sub-task to a new agent. Use this when you need to:
- Break down a complex task into smaller sub-tasks
- Run a task in isolation with clean context
- Execute a task that requires different expertise
- Avoid context window pollution

Returns the agent's response after completion.`,
    parameters: z.object({
      task: z.string().describe('The task to delegate to the sub-agent'),
      systemPrompt: z.string().optional().describe('Custom system prompt for the sub-agent'),
      model: z.string().optional().describe('Model to use (default: same as parent)'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 300)'),
    }),
  },
  handler: async (args: {
    task: string;
    systemPrompt?: string;
    model?: string;
    timeout?: number;
  }) => {
    const { task, systemPrompt, model, timeout = 300 } = args;
    
    try {
      // Create sub-agent runtime
      const toolRegistry = ToolRegistry.getInstance();
      const runtime = new AgentRuntime(toolRegistry);
      
      // Run task with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Task timeout')), timeout * 1000);
      });
      
      const taskPromise = runtime.run({
        name: 'subtask',
        model: model || 'anthropic/claude-3-5-haiku', // Fast model for sub-tasks
        systemPrompt: systemPrompt || 'You are a helpful AI assistant. Complete the given task efficiently.',
        messages: [{ role: 'user', content: task }],
        maxSteps: 30, // Limit steps for sub-tasks
      });
      
      const result = await Promise.race([taskPromise, timeoutPromise]);
      
      return {
        success: true,
        response: result.finalMessage,
        toolCallCount: result.toolCalls.length,
        duration: result.duration,
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  category: 'agent',
  isDangerous: false,
};

/**
 * Fleet delegation tool - Run task across multiple agents in parallel
 */
const fleetTool: ToolDefinition = {
  name: 'fleet',
  definition: {
    description: `Execute a task across multiple models in parallel (fleet execution). Use this when you need to:
- Compare different approaches to the same problem
- Get consensus from multiple models
- Find the most efficient solution
- Validate results across models

Returns aggregated results with ranking.`,
    parameters: z.object({
      task: z.string().describe('The task to execute in fleet mode'),
      models: z.array(z.string()).optional().describe('Models to use (default: claude, gpt4, gemini)'),
      maxConcurrency: z.number().optional().describe('Max concurrent agents (default: 3)'),
      timeout: z.number().optional().describe('Timeout per agent in seconds (default: 300)'),
    }),
  },
  handler: async (args: {
    task: string;
    models?: string[];
    maxConcurrency?: number;
    timeout?: number;
  }) => {
    const {
      task,
      models = [
        'anthropic/claude-3-5-sonnet',
        'openai/gpt-4o',
        'google/gemini-pro-1.5',
      ],
      maxConcurrency = 3,
      timeout = 300,
    } = args;
    
    try {
      // Create fleet orchestrator
      const toolRegistry = ToolRegistry.getInstance();
      const orchestrator = new FleetOrchestrator(toolRegistry);
      
      // Run fleet
      const result = await orchestrator.run({
        models,
        task,
        maxConcurrency,
        timeout: timeout * 1000,
      });
      
      // Find best result
      const successful = result.results.filter(r => r.success);
      const best = successful.length > 0 
        ? successful.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0]
        : null;
      
      return {
        success: result.successCount > 0,
        totalAgents: result.results.length,
        successCount: result.successCount,
        failureCount: result.failureCount,
        bestModel: best?.model,
        bestResponse: best?.result?.finalMessage,
        bestToolCount: best?.toolCallCount,
        allResults: result.results.map(r => ({
          model: r.model,
          success: r.success,
          rank: r.rank,
          toolCount: r.toolCallCount,
          duration: r.duration,
          response: r.result?.finalMessage?.substring(0, 200), // Truncate for summary
        })),
        totalDuration: result.totalDuration,
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  category: 'agent',
  isDangerous: false,
};

/**
 * Task delegation tools
 */
export default {
  task: taskTool,
  fleet: fleetTool,
};

// Also export individually for convenience
export { taskTool, fleetTool };
