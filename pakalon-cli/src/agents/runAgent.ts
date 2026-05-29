import { v4 as uuidv4 } from 'uuid';
import type {
  AgentDefinition,
  AgentToolInput,
  AgentToolResult,
  SpawnedAgent,
  AgentProgress,
  ResolvedAgentTools,
  BuiltInAgentDefinition,
} from './types.js';
import type { PermissionMode } from '@/store/slices/mode.slice.js';
import {
  AGENT_TOOL_NAME,
  ASYNC_AGENT_ALLOWED_TOOLS,
  ALL_AGENT_DISALLOWED_TOOLS,
  FORK_SUBAGENT_TYPE,
  ONE_SHOT_BUILTIN_AGENT_TYPES,
} from './constants.js';
import {
  resolveAgentTools,
  countToolUses,
  extractPartialResult,
} from './agentToolUtils.js';
import { getAgentSystemPrompt } from './prompt.js';
import { isBuiltInAgent } from './types.js';
import { useStore } from '@/store/index.js';
import logger from '@/utils/logger.js';
import { generateText, streamText, CoreMessage, GenerateTextResult } from 'ai';
import { openrouter } from '@openrouter/ai-sdk-provider';

const spawnedAgents = new Map<string, SpawnedAgent>();
const agentProgressCallbacks = new Map<string, (progress: AgentProgress) => void>();
const agentMessages = new Map<string, Array<{ role: string; content: string }>>();
const agentAbortControllers = new Map<string, AbortController>();

export function registerAgentProgressCallback(
  agentId: string,
  callback: (progress: AgentProgress) => void
): void {
  agentProgressCallbacks.set(agentId, callback);
}

export function unregisterAgentProgressCallback(agentId: string): void {
  agentProgressCallbacks.delete(agentId);
}

function emitProgress(progress: AgentProgress): void {
  const callback = agentProgressCallbacks.get(progress.agentId);
  if (callback) {
    callback(progress);
  }
}

export function getSpawnedAgent(agentId: string): SpawnedAgent | undefined {
  return spawnedAgents.get(agentId);
}

export function getAllSpawnedAgents(): SpawnedAgent[] {
  return Array.from(spawnedAgents.values());
}

export function getSpawnedAgentsByTeam(teamName: string): SpawnedAgent[] {
  return Array.from(spawnedAgents.values()).filter((a) => a.teamName === teamName);
}

export function updateSpawnedAgent(
  agentId: string,
  updates: Partial<SpawnedAgent>
): void {
  const agent = spawnedAgents.get(agentId);
  if (agent) {
    spawnedAgents.set(agentId, { ...agent, ...updates });
  }
}

export function removeSpawnedAgent(agentId: string): void {
  spawnedAgents.delete(agentId);
  unregisterAgentProgressCallback(agentId);
  agentMessages.delete(agentId);
  const controller = agentAbortControllers.get(agentId);
  if (controller) {
    controller.abort();
    agentAbortControllers.delete(agentId);
  }
}

export function stopAgent(agentId: string): boolean {
  const agent = spawnedAgents.get(agentId);
  if (!agent) {
    return false;
  }

  if (agent.status !== 'running') {
    return false;
  }

  const controller = agentAbortControllers.get(agentId);
  if (controller) {
    controller.abort();
  }

  updateSpawnedAgent(agentId, { status: 'stopped' });
  emitProgress({
    agentId,
    agentName: agent.name,
    status: 'stopped',
  });

  return true;
}

export function getAgentStatus(
  agentId: string
): SpawnedAgent['status'] | null {
  const agent = spawnedAgents.get(agentId);
  return agent?.status || null;
}

export function getAgentOutput(agentId: string): string | null {
  const agent = spawnedAgents.get(agentId);
  return agent?.result || null;
}

export function clearAllAgents(): void {
  for (const [agentId] of spawnedAgents) {
    removeSpawnedAgent(agentId);
  }
}

export function clearTeamAgents(teamName: string): void {
  const agents = getSpawnedAgentsByTeam(teamName);
  for (const agent of agents) {
    removeSpawnedAgent(agent.id);
  }
}

interface RunAgentOptions {
  agentDefinition: AgentDefinition;
  input: AgentToolInput;
  parentContext?: {
    agentId?: string;
    permissionMode?: PermissionMode;
    cwd?: string;
  };
  availableTools?: string[];
  forkContextMessages?: Array<{ role: string; content: string }>;
}

export async function spawnAgent(
  options: RunAgentOptions
): Promise<{ agent: SpawnedAgent; result: AgentToolResult }> {
  const { agentDefinition, input, parentContext, availableTools = [] } = options;

  const agentId = uuidv4();
  const agentType = input.subagent_type || 'general-purpose';
  const agentName = input.name || `${agentType}-${agentId.slice(0, 8)}`;

  const permissionMode: PermissionMode =
    input.mode || (agentDefinition.permissionMode as PermissionMode) || parentContext?.permissionMode || 'default';

  const tools = resolveAgentTools(
    agentDefinition,
    availableTools.length > 0 ? availableTools : ['*'],
    input.run_in_background ?? false,
    false
  );

  const context: SpawnedAgent = {
    id: agentId,
    name: agentName,
    type: agentType,
    teamName: input.team_name,
    model: input.model === 'inherit' ? undefined : (input.model || agentDefinition.model),
    permissionMode,
    cwd: input.cwd || parentContext?.cwd,
    background: input.run_in_background ?? agentDefinition.background ?? false,
    isolation: input.isolation || agentDefinition.isolation,
    createdAt: new Date().toISOString(),
    status: 'running',
  };

  if (context.isolation === 'remote') {
    logger.info(`[agents] remote isolation requested for ${agentId}`, {
      remoteIsolation: (agentDefinition as { remoteIsolation?: unknown }).remoteIsolation,
    });
  }

  spawnedAgents.set(agentId, context);
  agentMessages.set(agentId, []);
  const abortController = new AbortController();
  agentAbortControllers.set(agentId, abortController);

  emitProgress({
    agentId,
    agentName,
    status: 'starting',
  });

  if (context.background) {
    runAgentBackground(context, input, agentDefinition, tools, abortController).catch((err) => {
      logger.error(`Background agent ${agentId} failed:`, err);
      updateSpawnedAgent(agentId, { status: 'failed' });
      emitProgress({
        agentId,
        agentName,
        status: 'failed',
        error: String(err),
      });
    });

return {
    agent: context,
    result: {
      success: true,
      agentId,
      agentName,
      teamName: input.team_name,
      background: true,
      output: `Agent ${agentName} started in background`,
    },
  };
}

if (context.background) {
    runAgentBackground(context, input, agentDefinition, tools, abortController).catch((err) => {
      logger.error(`Background agent ${agentId} failed:`, err);
      updateSpawnedAgent(agentId, { status: 'failed' });
      emitProgress({
        agentId,
        agentName,
        status: 'failed',
        error: String(err),
      });
    });

    return {
      agent: context,
      result: {
        success: true,
        agentId,
        agentName,
        teamName: input.team_name,
        background: true,
        output: `Agent ${agentName} started in background`,
      },
    };
  }

const result = await runAgentSync(context, input, agentDefinition, tools, abortController);

  updateSpawnedAgent(agentId, {
    status: result.success ? 'completed' : 'failed',
    result: result.output,
  });

  emitProgress({
    agentId,
    agentName,
    status: result.success ? 'completed' : 'failed',
    output: result.output,
    error: result.error,
  });

  return {
    agent: context,
    result,
  };
}

async function runAgentSync(
  context: SpawnedAgent,
  input: AgentToolInput,
  agentDef: AgentDefinition,
  tools: ResolvedAgentTools,
  abortController: AbortController
): Promise<AgentToolResult> {
  const startTime = Date.now();

  emitProgress({
    agentId: context.id,
    agentName: context.name,
    status: 'running',
    progress: 0,
    message: 'Starting agent...',
  });

  try {
    const systemPrompt = getAgentSystemPrompt(agentDef);

    const messages: CoreMessage[] = [];

    if (input.description) {
      messages.push({
        role: 'system',
        content: `Task description: ${input.description}\n\n`,
      });
    }

    messages.push({
      role: 'user',
      content: input.prompt,
    });

    agentMessages.set(context.id, messages as any);

    emitProgress({
      agentId: context.id,
      agentName: context.name,
      status: 'running',
      progress: 50,
      message: 'Processing request...',
    });

    const maxTurns = input.maxTurns || agentDef.maxTurns || 100;

    const resolvedModel = context.model || 'anthropic/claude-3-5-sonnet';

    const isOneShot = ONE_SHOT_BUILTIN_AGENT_TYPES.has(context.type);

    const result = await generateText({
      model: openrouter(resolvedModel),
      system: systemPrompt,
      messages,
      maxTokens: 4096,
      temperature: 0.7,
      abortSignal: abortController.signal,
      tools: convertToolsToAIFormat(tools.resolvedTools),
    });

    const durationMs = Date.now() - startTime;

    const toolCallCount = countToolUses(messages as any);

    if (isBuiltInAgent(agentDef) && (agentDef as BuiltInAgentDefinition).callback) {
      try {
        (agentDef as BuiltInAgentDefinition).callback?.();
      } catch (callbackErr) {
        logger.warn(`Agent callback failed: ${callbackErr}`);
      }
    }

    return {
      success: true,
      output: result.text,
      agentId: context.id,
      agentName: context.name,
      totalDurationMs: durationMs,
      totalToolUseCount: toolCallCount,
      agentType: context.type,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        error: 'Agent execution aborted',
        agentId: context.id,
        agentName: context.name,
      };
    }

    logger.error(`Agent ${context.id} failed:`, err);

    return {
      success: false,
      error: String(err),
      agentId: context.id,
      agentName: context.name,
    };
  }
}

async function runAgentBackground(
  context: SpawnedAgent,
  input: AgentToolInput,
  agentDef: AgentDefinition,
  tools: ResolvedAgentTools,
  abortController: AbortController
): Promise<void> {
  logger.info(`Background agent ${context.id} (${context.name}) started`);

  const result = await runAgentSync(context, input, agentDef, tools, abortController);

  logger.info(`Background agent ${context.id} (${context.name}) completed`);

  updateSpawnedAgent(context.id, {
    status: result.success ? 'completed' : 'failed',
    result: result.output,
  });

  emitProgress({
    agentId: context.id,
    agentName: context.name,
    status: result.success ? 'completed' : 'failed',
    output: result.output,
    error: result.error,
  });
}

function convertToolsToAIFormat(tools: string[]): Record<string, { description: string; parameters: Record<string, unknown> }> {
  const converted: Record<string, { description: string; parameters: Record<string, unknown> }> = {};

  for (const toolName of tools) {
    if (toolName.startsWith('mcp__')) {
      converted[toolName] = {
        description: `MCP tool: ${toolName}`,
        parameters: { type: 'object', properties: {} },
      };
    } else {
      converted[toolName] = {
        description: `Tool: ${toolName}`,
        parameters: { type: 'object', properties: {} },
      };
    }
  }

  return converted;
}

export async function* runAgentStreaming(
  options: RunAgentOptions
): AsyncGenerator<string, AgentToolResult, void> {
  const { agentDefinition, input, parentContext, availableTools = [] } = options;

  const agentId = uuidv4();
  const agentType = input.subagent_type || 'general-purpose';
  const agentName = input.name || `${agentType}-${agentId.slice(0, 8)}`;

  const permissionMode: PermissionMode =
    input.mode || (agentDefinition.permissionMode as PermissionMode) || parentContext?.permissionMode || 'default';

  const tools = resolveAgentTools(
    agentDefinition,
    availableTools.length > 0 ? availableTools : ['*'],
    false,
    false
  );

  const context: SpawnedAgent = {
    id: agentId,
    name: agentName,
    type: agentType,
    teamName: input.team_name,
    model: input.model === 'inherit' ? undefined : (input.model || agentDefinition.model),
    permissionMode,
    cwd: input.cwd || parentContext?.cwd,
    background: false,
    isolation: input.isolation || agentDefinition.isolation,
    createdAt: new Date().toISOString(),
    status: 'running',
  };

  spawnedAgents.set(agentId, context);
  agentMessages.set(agentId, []);
  const abortController = new AbortController();
  agentAbortControllers.set(agentId, abortController);

  const startTime = Date.now();

  const systemPrompt = getAgentSystemPrompt(agentDefinition);

  const messages: CoreMessage[] = [];

  if (input.description) {
    messages.push({
      role: 'system',
      content: `Task description: ${input.description}\n\n`,
    });
  }

  messages.push({
    role: 'user',
    content: input.prompt,
  });

  const resolvedModel = context.model || 'anthropic/claude-3-5-sonnet';

  const result = streamText({
    model: openrouter(resolvedModel),
    system: systemPrompt,
    messages,
    maxTokens: 4096,
    temperature: 0.7,
    abortSignal: abortController.signal,
    tools: convertToolsToAIFormat(tools.resolvedTools),
  });

  let finalText = '';
  let toolCallCount = 0;

  try {
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text') {
        finalText += chunk.text;
        yield chunk.text;
      } else if (chunk.type === 'tool-call') {
        toolCallCount++;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      updateSpawnedAgent(agentId, { status: 'stopped' });
      return {
        success: false,
        error: 'Agent execution aborted',
        agentId,
        agentName,
      };
    }
    throw err;
  }

  const durationMs = Date.now() - startTime;

  updateSpawnedAgent(agentId, {
    status: 'completed',
    result: finalText,
  });

  return {
    success: true,
    output: finalText,
    agentId,
    agentName,
    totalDurationMs: durationMs,
    totalToolUseCount: toolCallCount,
    agentType,
  };
}

export function getAgentMessages(agentId: string): Array<{ role: string; content: string }> {
  return agentMessages.get(agentId) || [];
}

export function addAgentMessage(
  agentId: string,
  message: { role: string; content: string }
): void {
  const messages = agentMessages.get(agentId) || [];
  messages.push(message);
  agentMessages.set(agentId, messages);
}

export function filterIncompleteToolCalls(
  messages: Array<{ type?: string; message?: { content?: Array<{ type: string; id?: string }> } }>
): Array<{ type?: string; message?: { content?: Array<{ type: string; id?: string }> } }> {
  const toolUseIdsWithResults = new Set<string>();

  for (const message of messages) {
    if (message?.type === 'user') {
      const userMessage = message as { type: string; message?: { content?: Array<{ type: string; tool_use_id?: string }> } };
      const content = userMessage.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            toolUseIdsWithResults.add(block.tool_use_id);
          }
        }
      }
    }
  }

  return messages.filter((message) => {
    if (message?.type === 'assistant') {
      const assistantMessage = message as { type: string; message?: { content?: Array<{ type: string; id?: string }> } };
      const content = assistantMessage.message?.content;
      if (Array.isArray(content)) {
        const hasIncompleteToolCall = content.some(
          (block) => block.type === 'tool_use' && block.id && !toolUseIdsWithResults.has(block.id)
        );
        return !hasIncompleteToolCall;
      }
    }
    return true;
  });
}

export { filterIncompleteToolCalls as filterToolCalls };
