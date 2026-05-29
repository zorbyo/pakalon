/**
 * Resume Agent
 * Resumes a previously stopped agent from its state
 */
import type { AgentDefinition, Tools, AgentExecutionContext } from './types.js';
import { runAgent } from './runAgent.js';
import logger from '@/utils/logger.js';

interface ResumeOptions {
  agentId: string;
  agentDefinition?: AgentDefinition;
  prompt?: string;
  model?: string;
  maxTurns?: number;
  context: AgentExecutionContext['context'];
  availableTools: Tools;
  previousMessages?: any[];
}

interface ResumeResult {
  success: boolean;
  resumed: boolean;
  finalMessage: string;
  toolCalls: Array<{ toolName: string; args: any }>;
  duration: number;
}

export async function resumeAgent(options: ResumeOptions): Promise<ResumeResult> {
  const {
    agentId,
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    previousMessages,
  } = options;

  const startTime = Date.now();

  logger.info(`[resumeAgent] Resuming agent: ${agentId}`);

  if (!previousMessages || previousMessages.length === 0) {
    logger.warn(`[resumeAgent] No previous messages found for agent ${agentId}`);
    return {
      success: false,
      resumed: false,
      finalMessage: 'No previous state to resume from',
      toolCalls: [],
      duration: Date.now() - startTime,
    };
  }

  try {
    const resumePrompt =
      prompt ||
      'Please continue from where you left off. Review the previous conversation and continue completing your task.';

    const result = await runAgent({
      agentDefinition,
      prompt: resumePrompt,
      model,
      maxTurns,
      context,
      availableTools,
      forkContextMessages: previousMessages,
    });

    logger.info(`[resumeAgent] Agent ${agentId} resumed successfully`);

    return {
      success: result.success,
      resumed: true,
      finalMessage: result.finalMessage,
      toolCalls: result.toolCalls,
      duration: result.duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`[resumeAgent] Error resuming agent ${agentId}: ${errorMessage}`);

    return {
      success: false,
      resumed: false,
      finalMessage: `Error: ${errorMessage}`,
      toolCalls: [],
      duration: Date.now() - startTime,
    };
  }
}

export async function resumeAgentBackground(
  options: ResumeOptions,
): Promise<{ success: boolean; taskId: string }> {
  const {
    agentId,
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    previousMessages,
  } = options;

  const taskId = `agent-resume-${agentId}-${Date.now()}`;

  context.context?.setAppState?.((prev: any) => ({
    ...prev,
    tasks: {
      ...prev.tasks,
      [taskId]: {
        id: taskId,
        status: 'running',
        description: `Resuming agent ${agentId}`,
        agentType: agentDefinition?.agentType || 'unknown',
        createdAt: Date.now(),
      },
    },
  }));

  resumeAgent({
    agentId,
    agentDefinition,
    prompt,
    model,
    maxTurns,
    context,
    availableTools,
    previousMessages,
  })
    .then(result => {
      context.context?.setAppState?.((prev: any) => ({
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...prev.tasks[taskId],
            status: result.success ? 'completed' : 'failed',
            result: result.finalMessage,
            completedAt: Date.now(),
          },
        },
      }));
    })
    .catch(error => {
      logger.error(`[resumeAgentBackground] Error: ${error}`);
    });

  return {
    success: true,
    taskId,
  };
}

export { resumeAgent, resumeAgentBackground };