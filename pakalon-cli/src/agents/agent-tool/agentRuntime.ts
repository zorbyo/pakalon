import type {
  AgentContext,
  AgentToolInput,
  AgentToolResult,
  SpawnedAgent,
  AgentProgress,
  AgentDefinition,
} from './types.js';
import { AGENT_TOOL_NAME } from './constants.js';
import { getAgentDefinition } from './loadAgents.js';
import { getBuiltInAgent } from './builtInAgents.js';
import { getAgentColor } from './agentColorManager.js';
import { useStore } from '@/store/index.js';
import { generateText, type CoreMessage } from 'ai';
import { openrouter } from '@/ai/openrouter.js';
import logger from '@/utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const spawnedAgents = new Map<string, SpawnedAgent>();
const agentProgressCallbacks = new Map<string, (progress: AgentProgress) => void>();

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

export function updateSpawnedAgent(agentId: string, updates: Partial<SpawnedAgent>): void {
  const agent = spawnedAgents.get(agentId);
  if (agent) {
    spawnedAgents.set(agentId, { ...agent, ...updates });
  }
}

export function removeSpawnedAgent(agentId: string): void {
  spawnedAgents.delete(agentId);
  unregisterAgentProgressCallback(agentId);
}

export async function spawnAgent(
  input: AgentToolInput,
  parentContext?: AgentContext
): Promise<{ agent: SpawnedAgent; result: AgentToolResult }> {
  const agentId = uuidv4();
  const agentType = input.subagent_type || 'GeneralPurpose';
  const agentName = input.name || `${agentType}-${agentId.slice(0, 8)}`;

  const agentDef = getAgentDefinition(agentType) || getBuiltInAgent(agentType);

  if (!agentDef) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const permissionMode = input.mode || agentDef.permissionMode || parentContext?.permissionMode || 'normal';

  const context: AgentContext = {
    agentId,
    agentName,
    agentType,
    teamName: input.team_name,
    parentAgentId: parentContext?.agentId,
    permissionMode,
    tools: resolveAgentTools(agentDef),
    disallowedTools: agentDef.disallowedTools || [],
    model: input.model === 'inherit' ? undefined : (input.model || agentDef.model),
    maxTurns: input.maxTurns || agentDef.maxTurns,
    memory: agentDef.memory,
    background: input.run_in_background ?? agentDef.background ?? false,
    isolation: input.isolation || agentDef.isolation,
    cwd: input.cwd,
  };

  const spawnedAgent: SpawnedAgent = {
    id: agentId,
    name: agentName,
    type: agentType,
    teamName: input.team_name,
    model: context.model,
    permissionMode,
    cwd: context.cwd,
    background: context.background,
    isolation: context.isolation,
    createdAt: new Date().toISOString(),
    status: 'running',
  };

  spawnedAgents.set(agentId, spawnedAgent);

  if (context.background) {
    runAgentBackground(context, input.prompt, agentDef).catch((err) => {
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
      agent: spawnedAgent,
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

  emitProgress({
    agentId,
    agentName,
    status: 'starting',
  });

  const result = await runAgent(context, input.prompt, agentDef);

  updateSpawnedAgent(agentId, {
    status: 'completed',
    result: result.output,
  });

  emitProgress({
    agentId,
    agentName,
    status: 'completed',
    output: result.output,
  });

  return {
    agent: spawnedAgent,
    result,
  };
}

function resolveAgentTools(agentDef: AgentDefinition): string[] {
  if (agentDef.tools && agentDef.tools.includes('*')) {
    return ['*'];
  }

  if (agentDef.tools && agentDef.tools.length > 0) {
    return agentDef.tools;
  }

  return ['*'];
}

async function runAgent(
  context: AgentContext,
  prompt: string,
  _agentDef: AgentDefinition
): Promise<AgentToolResult> {
  emitProgress({
    agentId: context.agentId,
    agentName: context.agentName,
    status: 'running',
    progress: 0,
    message: 'Starting agent...',
  });

  try {
    const messages: CoreMessage[] = [
      { role: 'user', content: prompt },
    ];

    const maxTurns = context.maxTurns || 100;

    const result = await generateText({
      model: openrouter(context.model || 'anthropic/claude-3-5-sonnet'),
      messages,
      maxTokens: 4096,
      maxTurns,
    });

    emitProgress({
      agentId: context.agentId,
      agentName: context.agentName,
      status: 'completed',
      progress: 100,
      output: result.text,
    });

    return {
      success: true,
      output: result.text,
    };
  } catch (err) {
    logger.error(`Agent ${context.agentId} failed:`, err);

    emitProgress({
      agentId: context.agentId,
      agentName: context.agentName,
      status: 'failed',
      error: String(err),
    });

    return {
      success: false,
      error: String(err),
    };
  }
}

async function runAgentBackground(
  context: AgentContext,
  prompt: string,
  agentDef: AgentDefinition
): Promise<void> {
  logger.info(`Background agent ${context.agentId} (${context.agentName}) started`);

  await runAgent(context, prompt, agentDef);

  logger.info(`Background agent ${context.agentId} (${context.agentName}) completed`);
}

export function stopAgent(agentId: string): boolean {
  const agent = spawnedAgents.get(agentId);
  if (!agent) {
    return false;
  }

  if (agent.status !== 'running') {
    return false;
  }

  updateSpawnedAgent(agentId, { status: 'stopped' });

  emitProgress({
    agentId,
    agentName: agent.name,
    status: 'stopped',
  });

  return true;
}

export function getAgentStatus(agentId: string): SpawnedAgent['status'] | null {
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