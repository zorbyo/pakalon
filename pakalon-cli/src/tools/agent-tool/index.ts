/**
 * Agent Tool - Multi-agent orchestration system
 * Enables spawning sub-agents with different capabilities
 */
import { z } from 'zod';
import { ToolRegistry } from '@/ai/tool-registry';
import type { ToolDefinition } from '@/ai/tool-registry';
import { runAgent } from './runAgent.js';
import { resumeAgent } from './resumeAgent.js';
import { forkSubagent } from './forkSubagent.js';
import { loadAgentsDir } from './loadAgentsDir.js';
import {
  resolveAgentTools,
  filterToolsForAgent,
  type ResolvedAgentTools,
} from './agentToolUtils.js';
import { getBuiltInAgents } from './builtInAgents.js';
import { getAgentColor } from './agentColorManager.js';
import type { AgentDefinition, AgentToolResult } from './types.js';
import logger from '@/utils/logger.js';

export const AGENT_TOOL_NAME = 'Agent';
export const LEGACY_AGENT_TOOL_NAME = 'Task';

const AgentToolSchema = z.object({
  subagent_type: z
    .string()
    .describe(
      'Type of sub-agent to spawn (e.g., explore, plan, verification). Omit to fork current context.',
    ),
  prompt: z.string().describe('The task or question for the sub-agent'),
  model: z
    .string()
    .optional()
    .describe('Model to use for this agent (defaults to agent type default)'),
  max_turns: z
    .number()
    .optional()
    .describe('Maximum number of turns before agent stops'),
  background: z
    .boolean()
    .optional()
    .describe('Run in background and return immediately'),
});

export type AgentToolInput = z.infer<typeof AgentToolSchema>;

interface AgentToolContext {
  getAppState: () => any;
  setAppState: (updater: (prev: any) => any) => void;
  abortController: AbortController;
  options: {
    tools: any[];
    mcpClients?: any[];
    isNonInteractiveSession?: boolean;
  };
}

const agentTool: ToolDefinition = {
  name: AGENT_TOOL_NAME,
  definition: {
    description: `Spawn a sub-agent to accomplish a specific task. Use sub-agents for:
- Parallel task execution
- Isolation from main context
- Specialized expertise (explore, plan, verification)
- Background execution for long-running tasks

Each sub-agent has its own context and can use tools independently.`,
    parameters: AgentToolSchema,
  },
  requiresPermission: false,
  handler: async (args: AgentToolInput, context: AgentToolContext) => {
    const { subagent_type, prompt, model, max_turns, background } = args;

    logger.info(`[AgentTool] Spawning sub-agent: ${subagent_type || 'fork'}`);

    try {
      const toolRegistry = ToolRegistry.getInstance();
      const availableTools = await toolRegistry.getTools();

      let agentDefinition: AgentDefinition | undefined;
      if (subagent_type) {
        const agents = getBuiltInAgents();
        agentDefinition = agents.find(a => a.agentType === subagent_type);
        if (!agentDefinition) {
          const customAgents = await loadAgentsDir();
          agentDefinition = customAgents.find(a => a.agentType === subagent_type);
        }
      }

      if (!agentDefinition && subagent_type) {
        return {
          success: false,
          error: `Unknown agent type: ${subagent_type}`,
        };
      }

      if (background) {
        return await spawnBackgroundAgent({
          agentDefinition,
          prompt,
          model,
          maxTurns: max_turns,
          context,
        });
      }

      const result = await runAgent({
        agentDefinition,
        prompt,
        model,
        maxTurns: max_turns,
        context,
        availableTools,
      });

      return result;
    } catch (error) {
      logger.error(`[AgentTool] Error: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

async function spawnBackgroundAgent({
  agentDefinition,
  prompt,
  model,
  maxTurns,
  context,
}: {
  agentDefinition?: AgentDefinition;
  prompt: string;
  model?: string;
  maxTurns?: number;
  context: AgentToolContext;
}): Promise<{ success: boolean; taskId: string }> {
  const taskId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const toolRegistry = ToolRegistry.getInstance();
  const availableTools = await toolRegistry.getTools();

  context.setAppState((prev: any) => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [taskId]: {
        id: taskId,
        status: 'running',
        description: prompt.substring(0, 100),
        agentType: agentDefinition?.agentType || 'fork',
        createdAt: Date.now(),
      },
    },
  }));

  runAgent({
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    isAsync: true,
  }).catch(error => {
    logger.error(`[AgentTool] Background agent error: ${error}`);
  });

  return {
    success: true,
    taskId,
  };
}

export default agentTool;
export {
  runAgent,
  resumeAgent,
  forkSubagent,
  loadAgentsDir,
  resolveAgentTools,
  filterToolsForAgent,
  getBuiltInAgents,
  getAgentColor,
};
export type { AgentToolResult, ResolvedAgentTools, AgentDefinition };