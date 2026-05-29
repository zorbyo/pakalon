import { z } from 'zod';
import { buildTool, type ToolDef } from '@/tools/tool-types.js';
import {
  spawnAgent,
  stopAgent,
  getAgentStatus,
  getAgentOutput,
  getSpawnedAgent,
  getAllSpawnedAgents,
  getSpawnedAgentsByTeam,
} from '../runAgent.js';
import {
  getAgentDefinition,
  getAgentDefinitions,
  filterAgentsByMcpRequirements,
} from '../loadAgents.js';
import { getBuiltInAgents } from '../builtInAgents.js';
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  AGENT_COLORS,
} from '../constants.js';
import type {
  AgentToolInput,
  AgentToolResult,
  AgentProgress,
  AgentDefinition,
} from '../types.js';
import { useStore } from '@/store/index.js';
import logger from '@/utils/logger.js';

const AgentToolInputSchema = z.object({
  description: z.string().optional().describe('Description of what the agent should do'),
  prompt: z.string().describe('The task or question to give the agent'),
  subagent_type: z
    .string()
    .optional()
    .describe(
      'Type of agent to spawn (e.g., Explore, Plan, GeneralPurpose). ' +
        'If omitted, uses GeneralPurpose agent.'
    ),
  model: z
    .enum(['sonnet', 'opus', 'haiku', 'inherit'])
    .optional()
    .describe('Model to use for this agent. "inherit" uses the same model as parent.'),
  run_in_background: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to run the agent in the background'),
  name: z.string().optional().describe('Custom name for this agent instance'),
  team_name: z.string().optional().describe('Team name for multi-agent collaboration'),
  mode: z
    .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto', 'bubble'])
    .optional()
    .describe('Permission mode for the agent'),
  isolation: z.enum(['worktree', 'remote']).optional().describe('Isolation mode for the agent'),
  cwd: z.string().optional().describe('Working directory for the agent'),
  tools: z.array(z.string()).optional().describe('Specific tools to allow for this agent'),
  maxTurns: z.number().optional().describe('Maximum turns for the agent'),
});

type InputSchema = typeof AgentToolInputSchema;

const TaskStopInputSchema = z.object({
  agentId: z.string().describe('The ID of the agent to stop'),
});

const TaskOutputInputSchema = z.object({
  agentId: z.string().describe('The ID of the agent'),
  wait: z.boolean().optional().default(false).describe('Wait for agent to complete'),
  timeout: z.number().optional().default(5000).describe('Timeout in ms when waiting'),
});

const TaskListInputSchema = z.object({
  teamName: z.string().optional().describe('Filter by team name'),
  status: z.enum(['running', 'completed', 'failed', 'stopped']).optional().describe('Filter by status'),
});

const ListAgentsInputSchema = z.object({
  includeBuiltIn: z.boolean().optional().default(true).describe('Include built-in agents'),
  includeCustom: z.boolean().optional().default(true).describe('Include custom agents'),
});

export const AgentTool = buildTool({
  name: AGENT_TOOL_NAME,
  aliases: [LEGACY_AGENT_TOOL_NAME],
  searchHint: 'spawn a sub-agent to handle complex tasks',
  maxResultSizeChars: 100_000,
  inputSchema: AgentToolInputSchema,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly() {
    return false;
  },
  async checkPermissions(input, context) {
    const permissionMode = context?.getAppState?.()?.toolPermissionContext?.mode;
    if (permissionMode === 'plan') {
      return {
        behavior: 'deny',
        reason: 'Agent spawning is not allowed in plan mode',
      };
    }
    return { behavior: 'allow' };
  },
  async description() {
    const builtIn = getBuiltInAgents();
    const agentDescriptions = builtIn
      .map((a) => `- **${a.agentType}**: ${a.whenToUse || a.description || 'General purpose agent'}`)
      .join('\n');

    return `Spawn a sub-agent to help accomplish tasks. Agents can work in parallel and communicate via teams.

Available agent types:
${agentDescriptions}

Agents can be used for:
- Parallel task execution
- Specialized expertise (debugging, refactoring, testing, docs)
- Background processing
- Multi-agent collaboration via teams`;
  },
  async prompt() {
    const agents = getAgentDefinitions();
    const { getPrompt } = await import('../prompt.js');
    return getPrompt(agents);
  },
  async call({ description, prompt, subagent_type, model, run_in_background, name, team_name, mode, isolation, cwd, tools, maxTurns }, context) {
    const permissionMode = context?.getAppState?.()?.toolPermissionContext?.mode;

    if (permissionMode === 'plan') {
      return {
        success: false,
        error: 'Agent spawning is not allowed in plan mode. Switch to normal or auto-accept mode.',
      };
    }

    const input: AgentToolInput = {
      description,
      prompt,
      subagent_type,
      model,
      run_in_background,
      name,
      team_name,
      mode,
      isolation,
      cwd,
      tools,
      maxTurns,
    };

    try {
      if (subagent_type) {
        const agentDef = getAgentDefinition(subagent_type);
        if (!agentDef) {
          const available = getBuiltInAgents()
            .map((a) => a.agentType)
            .join(', ');
          return {
            success: false,
            error: `Unknown agent type: ${subagent_type}. Available types: ${available}`,
          };
        }
      }

      const { result } = await spawnAgent({
        agentDefinition: getAgentDefinition(subagent_type || 'general-purpose')!,
        input,
        parentContext: {
          agentId: context?.agentId,
          permissionMode: permissionMode as any,
          cwd,
        },
        availableTools: tools,
      });

      return result;
    } catch (err) {
      logger.error('AgentTool error:', err);
      return {
        success: false,
        error: `Agent execution failed: ${String(err)}`,
      };
    }
  },
  toAutoClassifierInput(input) {
    return `${input.subagent_type || 'general-purpose'}: ${input.prompt}`;
  },
  userFacingName(input) {
    return input?.subagent_type || 'Agent';
  },
  userFacingNameBackgroundColor() {
    return undefined;
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (!output.success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          {
            type: 'text',
            text: `Agent failed: ${output.error || 'Unknown error'}`,
          },
        ],
      };
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'text',
          text: output.output || 'Agent completed successfully',
        },
      ],
    };
  },
  getToolUseSummary(input) {
    return `Spawn ${input.subagent_type || 'general-purpose'} agent: ${input.prompt?.slice(0, 50)}...`;
  },
  getActivityDescription(input) {
    return `Running ${input.subagent_type || 'agent'}`;
  },
} satisfies ToolDef<InputSchema, AgentToolResult>);

export const TaskStopTool = buildTool({
  name: 'TaskStop',
  searchHint: 'stop a running background agent',
  maxResultSizeChars: 1000,
  inputSchema: TaskStopInputSchema,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly() {
    return false;
  },
  async checkPermissions() {
    return { behavior: 'allow' };
  },
  async description() {
    return 'Stop a running background agent by ID';
  },
  async call({ agentId }) {
    const agent = getSpawnedAgent(agentId);

    if (!agent) {
      return { success: false, error: `Agent not found: ${agentId}` };
    }

    if (agent.status !== 'running') {
      return { success: false, error: `Agent is not running (status: ${agent.status})` };
    }

    const stopped = stopAgent(agentId);
    if (stopped) {
      return { success: true };
    }

    return { success: false, error: 'Failed to stop agent' };
  },
  toAutoClassifierInput(input) {
    return `stop agent ${input.agentId}`;
  },
  userFacingName() {
    return 'TaskStop';
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'text',
          text: output.success ? 'Agent stopped successfully' : `Failed: ${output.error}`,
        },
      ],
    };
  },
} satisfies ToolDef<typeof TaskStopInputSchema, { success: boolean; error?: string }>);

export const TaskOutputTool = buildTool({
  name: 'TaskOutput',
  searchHint: 'get output of a completed or running agent',
  maxResultSizeChars: 50000,
  inputSchema: TaskOutputInputSchema,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async checkPermissions() {
    return { behavior: 'allow' };
  },
  async description() {
    return 'Get the output of a completed or running background agent';
  },
  async call({ agentId, wait, timeout }) {
    const agent = getSpawnedAgent(agentId);

    if (!agent) {
      return { success: false, agentId, status: 'not_found', error: 'Agent not found' };
    }

    if (agent.status === 'running' && wait) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const currentAgent = getSpawnedAgent(agentId);
        if (currentAgent?.status !== 'running') {
          return {
            success: true,
            agentId,
            status: currentAgent?.status || 'unknown',
            output: currentAgent?.result,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return {
      success: true,
      agentId,
      status: agent.status,
      output: agent.result,
    };
  },
  toAutoClassifierInput(input) {
    return `get output for agent ${input.agentId}`;
  },
  userFacingName() {
    return 'TaskOutput';
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'text',
          text: `Agent ${output.status}: ${output.output || 'No output'}`,
        },
      ],
    };
  },
} satisfies ToolDef<typeof TaskOutputInputSchema, { success: boolean; agentId: string; status: string; output?: string; error?: string }>);

export const TaskListTool = buildTool({
  name: 'TaskList',
  searchHint: 'list all spawned agents',
  maxResultSizeChars: 5000,
  inputSchema: TaskListInputSchema,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async checkPermissions() {
    return { behavior: 'allow' };
  },
  async description() {
    return 'List all spawned agents';
  },
  async call({ teamName, status }) {
    let agents = getAllSpawnedAgents();

    if (teamName) {
      agents = agents.filter((a) => a.teamName === teamName);
    }

    if (status) {
      agents = agents.filter((a) => a.status === status);
    }

    return {
      success: true,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        teamName: a.teamName,
        status: a.status,
        createdAt: a.createdAt,
        result: a.result,
      })),
      count: agents.length,
    };
  },
  toAutoClassifierInput(input) {
    return `list agents${input.teamName ? ` for team ${input.teamName}` : ''}${
      input.status ? ` with status ${input.status}` : ''
    }`;
  },
  userFacingName() {
    return 'TaskList';
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'text',
          text: `${output.count} agent(s): ${output.agents.map((a) => `${a.name} (${a.status})`).join(', ')}`,
        },
      ],
    };
  },
} satisfies ToolDef<typeof TaskListInputSchema, { success: boolean; agents: any[]; count: number }>);

export const ListAgentsTool = buildTool({
  name: 'ListAgents',
  searchHint: 'list all available agent types',
  maxResultSizeChars: 10000,
  inputSchema: ListAgentsInputSchema,
  isEnabled() {
    return true;
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async checkPermissions() {
    return { behavior: 'allow' };
  },
  async description() {
    return 'List all available agent types';
  },
  async call({ includeBuiltIn = true, includeCustom = true }) {
    const definitions = getAgentDefinitions();

    const filtered = definitions.filter((def) => {
      if (def.source === 'built-in' && !includeBuiltIn) return false;
      if (def.source !== 'built-in' && !includeCustom) return false;
      return true;
    });

    return {
      success: true,
      agents: filtered.map((def) => ({
        type: def.agentType,
        description: def.description,
        whenToUse: def.whenToUse,
        source: def.source,
        tools: def.tools,
        disallowedTools: def.disallowedTools,
        model: def.model,
        background: def.background,
        color: def.color,
      })),
      count: filtered.length,
    };
  },
  toAutoClassifierInput() {
    return 'list available agent types';
  },
  userFacingName() {
    return 'ListAgents';
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [
        {
          type: 'text',
          text: `${output.count} agent type(s) available:\n${output.agents.map((a) => `- ${a.type}`).join('\n')}`,
        },
      ],
    };
  },
} satisfies ToolDef<typeof ListAgentsInputSchema, { success: boolean; agents: any[]; count: number }>);

export function getAllAgentTools() {
  return {
    [AGENT_TOOL_NAME.toLowerCase()]: AgentTool,
    agent: AgentTool,
    taskstop: TaskStopTool,
    taskoutput: TaskOutputTool,
    tasklist: TaskListTool,
    listagents: ListAgentsTool,
  };
}

export { registerAgentProgressCallback } from '../runAgent.js';
export type { AgentProgress };