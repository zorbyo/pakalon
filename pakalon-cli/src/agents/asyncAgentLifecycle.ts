/**
 * Async Agent Lifecycle Management
 * Handles the full lifecycle of background agents including:
 * - Registration with abort controllers
 * - Progress tracking and summarization
 * - Foreground-to-background transitions
 * - Cleanup on completion
 */

import type { AgentDefinition, AgentProgress, ToolUseContext } from './types.js';
import { generateText, type CoreMessage } from 'ai';
import { openrouter } from '@/ai/openrouter.js';
import logger from '@/utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export interface AsyncAgentTask {
  agentId: string;
  taskId: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  abortController: AbortController;
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
  progress?: AgentProgress;
  summary?: string;
  outputPath?: string;
}

export interface AgentLifecycleOptions {
  agentId: string;
  taskId: string;
  description: string;
  selectedAgent: AgentDefinition;
  promptMessages: CoreMessage[];
  toolUseContext: ToolUseContext;
  model?: string;
  enableSummarization?: boolean;
  worktreePath?: string;
}

// Active async agents
const asyncAgents = new Map<string, AsyncAgentTask>();

// Progress trackers
const progressTrackers = new Map<string, {
  toolUseCount: number;
  latestInputTokens: number;
  cumulativeOutputTokens: number;
  recentActivities: Array<{ toolName: string; activityDescription?: string; timestamp: number }>;
}>();

// Summarization timers
const summarizationTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Register a new async agent task
 */
export function registerAsyncAgent(options: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState?: (f: (prev: any) => any) => void;
  toolUseId?: string;
}): AsyncAgentTask {
  const taskId = options.agentId;
  const abortController = new AbortController();

  const task: AsyncAgentTask = {
    agentId: options.agentId,
    taskId,
    description: options.description,
    status: 'running',
    abortController,
    startedAt: Date.now(),
  };

  asyncAgents.set(taskId, task);

  // Initialize progress tracker
  progressTrackers.set(taskId, {
    toolUseCount: 0,
    latestInputTokens: 0,
    cumulativeOutputTokens: 0,
    recentActivities: [],
  });

  logger.info(`[AsyncAgent] Registered agent ${taskId}: ${options.description}`);

  return task;
}

/**
 * Unregister an async agent and clean up resources
 */
export function unregisterAsyncAgent(taskId: string): void {
  const task = asyncAgents.get(taskId);
  if (task) {
    task.endedAt = Date.now();
    asyncAgents.delete(taskId);
    progressTrackers.delete(taskId);

    // Clear any summarization timer
    const timer = summarizationTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      summarizationTimers.delete(taskId);
    }

    logger.info(`[AsyncAgent] Unregistered agent ${taskId}`);
  }
}

/**
 * Update agent progress
 */
export function updateAgentProgress(
  taskId: string,
  progress: Partial<AgentProgress>,
  setAppState?: (f: (prev: any) => any) => void
): void {
  const task = asyncAgents.get(taskId);
  if (task) {
    task.progress = { ...task.progress, ...progress };

    // If setAppState is provided, update the app state as well
    if (setAppState) {
      setAppState((prev) => ({
        ...prev,
        agentProgress: {
          ...prev.agentProgress,
          [taskId]: task.progress,
        },
      }));
    }
  }
}

/**
 * Update agent summary (for summarization service)
 */
export function updateAgentSummary(
  taskId: string,
  summary: string,
  setAppState?: (f: (prev: any) => any) => void
): void {
  const task = asyncAgents.get(taskId);
  if (task) {
    task.summary = summary;
    updateAgentProgress(taskId, { summary }, setAppState);
    logger.debug(`[AsyncAgent] Updated summary for ${taskId}: ${summary}`);
  }
}

/**
 * Complete an async agent task
 */
export function completeAsyncAgent(
  taskId: string,
  result: string,
  setAppState?: (f: (prev: any) => any) => void
): void {
  const task = asyncAgents.get(taskId);
  if (task) {
    task.status = 'completed';
    task.result = result;
    task.endedAt = Date.now();

    updateAgentProgress(taskId, {
      summary: result.slice(0, 100),
    }, setAppState);

    logger.info(`[AsyncAgent] Agent ${taskId} completed`);
  }
}

/**
 * Fail an async agent task
 */
export function failAsyncAgent(
  taskId: string,
  error: string,
  setAppState?: (f: (prev: any) => any) => void
): void {
  const task = asyncAgents.get(taskId);
  if (task) {
    task.status = 'failed';
    task.error = error;
    task.endedAt = Date.now();

    updateAgentProgress(taskId, {
      summary: `Failed: ${error.slice(0, 100)}`,
    }, setAppState);

    logger.error(`[AsyncAgent] Agent ${taskId} failed: ${error}`);
  }
}

/**
 * Kill an async agent task
 */
export function killAsyncAgent(
  taskId: string,
  setAppState?: (f: (prev: any) => any) => void
): boolean {
  const task = asyncAgents.get(taskId);
  if (!task) return false;

  if (task.status !== 'running') return false;

  task.abortController.abort();
  task.status = 'killed';
  task.endedAt = Date.now();

  updateAgentProgress(taskId, {
    summary: 'Killed',
  }, setAppState);

  logger.info(`[AsyncAgent] Agent ${taskId} killed`);
  return true;
}

/**
 * Get all active async agents
 */
export function getActiveAsyncAgents(): AsyncAgentTask[] {
  return Array.from(asyncAgents.values()).filter((a) => a.status === 'running');
}

/**
 * Get an async agent by task ID
 */
export function getAsyncAgent(taskId: string): AsyncAgentTask | undefined {
  return asyncAgents.get(taskId);
}

/**
 * Get token count from progress tracker
 */
export function getTokenCountFromTracker(taskId: string): number {
  const tracker = progressTrackers.get(taskId);
  if (!tracker) return 0;
  return tracker.latestInputTokens + tracker.cumulativeOutputTokens;
}

/**
 * Get progress update for an agent
 */
export function getProgressUpdate(taskId: string): AgentProgress | undefined {
  const tracker = progressTrackers.get(taskId);
  const task = asyncAgents.get(taskId);
  if (!tracker || !task) return undefined;

  return {
    toolUseCount: tracker.toolUseCount,
    tokenCount: getTokenCountFromTracker(taskId),
    lastActivity: tracker.recentActivities[tracker.recentActivities.length - 1],
    recentActivities: [...tracker.recentActivities],
    summary: task.summary,
  };
}

/**
 * Update progress tracker from a message
 */
export function updateProgressFromMessage(
  taskId: string,
  message: { type: string; message?: { content?: Array<any>; usage?: any } }
): void {
  const tracker = progressTrackers.get(taskId);
  if (!tracker) return;

  if (message.type === 'assistant' && message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_use') {
        tracker.toolUseCount++;
        tracker.recentActivities.push({
          toolName: block.name,
          timestamp: Date.now(),
        });

        // Keep only last 5 activities
        if (tracker.recentActivities.length > 5) {
          tracker.recentActivities.shift();
        }
      }
    }

    // Update token counts
    if (message.message?.usage) {
      const usage = message.message.usage;
      tracker.latestInputTokens = (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      tracker.cumulativeOutputTokens += usage.output_tokens || 0;
    }
  }
}

/**
 * Start agent summarization (periodically summarize agent progress)
 */
export function startAgentSummarization(
  taskId: string,
  agentId: string,
  cacheSafeParams: {
    model: string;
    system?: string;
    messages: CoreMessage[];
  },
  setAppState?: (f: (prev: any) => any) => void,
  getTranscript?: () => Promise<{ messages: any[] } | null>
): { stop: () => void } {
  let stopped = false;
  let previousSummary: string | null = null;
  const SUMMARY_INTERVAL_MS = 30_000;

  async function runSummary(): Promise<void> {
    if (stopped) return;

    try {
      // Get current transcript if available
      if (!getTranscript) {
        return;
      }

      const transcript = await getTranscript();
      if (!transcript || transcript.messages.length < 3) {
        return;
      }

      // Build summary prompt
      const prevLine = previousSummary
        ? `\nPrevious: "${previousSummary}" — say something NEW.\n`
        : '';

      const summaryPrompt = `Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.
${prevLine}
Good: "Reading runAgent.ts"
Good: "Fixing null check in validate.ts"
Bad (past tense): "Analyzed the branch diff"
Bad (too vague): "Investigating the issue"`;

      // Create a mini query to get summary
      const summaryMessages: CoreMessage[] = [
        { role: 'user', content: summaryPrompt },
      ];

      const result = await generateText({
        model: openrouter(cacheSafeParams.model || 'anthropic/claude-3-5-sonnet'),
        messages: summaryMessages,
        maxTokens: 50,
      });

      if (stopped) return;

      const summaryText = result.text.trim();
      if (summaryText) {
        previousSummary = summaryText;
        updateAgentSummary(taskId, summaryText, setAppState);
        logger.debug(`[AgentSummary] Summary for ${taskId}: ${summaryText}`);
      }
    } catch (e) {
      if (!stopped && e instanceof Error) {
        logger.error(`[AgentSummary] Error summarizing ${taskId}:`, e);
      }
    }

    // Schedule next summary
    if (!stopped) {
      const timer = setTimeout(runSummary, SUMMARY_INTERVAL_MS);
      summarizationTimers.set(taskId, timer);
    }
  }

  // Start first summary
  const timer = setTimeout(runSummary, SUMMARY_INTERVAL_MS);
  summarizationTimers.set(taskId, timer);

  return {
    stop() {
      stopped = true;
      const t = summarizationTimers.get(taskId);
      if (t) {
        clearTimeout(t);
        summarizationTimers.delete(taskId);
      }
    },
  };
}

/**
 * Run async agent lifecycle with full streaming support
 */
export async function runAsyncAgentLifecycle({
  taskId,
  abortController,
  makeStream,
  metadata,
  description,
  toolUseContext,
  rootSetAppState,
  agentIdForCleanup,
  enableSummarization = false,
  getWorktreeResult,
}: {
  taskId: string;
  abortController: AbortController;
  makeStream: (onCacheSafeParams?: any) => AsyncGenerator<any>;
  metadata: {
    prompt: string;
    resolvedAgentModel: string;
    isBuiltInAgent: boolean;
    startTime: number;
    agentType: string;
    isAsync: boolean;
  };
  description: string;
  toolUseContext: ToolUseContext;
  rootSetAppState?: (f: (prev: any) => any) => void;
  agentIdForCleanup?: string;
  enableSummarization?: boolean;
  getWorktreeResult?: () => Promise<{ worktreePath?: string }>;
}): Promise<void> {
  let summarizationHandle: { stop: () => void } | null = null;

  try {
    // Start summarization if enabled
    if (enableSummarization) {
      summarizationHandle = startAgentSummarization(
        taskId,
        metadata.agentType,
        { model: metadata.resolvedAgentModel },
        rootSetAppState
      );
    }

    // Run the agent stream
    let finalMessages: any[] = [];
    for await (const update of makeStream()) {
      if (abortController.signal.aborted) {
        break;
      }

      // Update progress from messages
      if (update.message) {
        updateProgressFromMessage(taskId, update.message);
        finalMessages.push(update.message);

        // Update progress in state
        updateAgentProgress(taskId, getProgressUpdate(taskId), rootSetAppState);
      }
    }

    // Extract final result
    const lastAssistant = finalMessages.filter((m) => m.type === 'assistant').pop();
    const resultText = lastAssistant?.message?.content
      ?.filter((b: any) => b.type === 'text')
      ?.map((b: any) => b.text)
      ?.join('\n') || 'Agent completed';

    completeAsyncAgent(taskId, resultText, rootSetAppState);

    // Get worktree result if applicable
    if (getWorktreeResult) {
      const worktreeResult = await getWorktreeResult();
      if (worktreeResult.worktreePath) {
        logger.debug(`[AsyncAgent] Worktree result: ${worktreeResult.worktreePath}`);
      }
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    failAsyncAgent(taskId, errorMessage, rootSetAppState);
  } finally {
    // Stop summarization
    summarizationHandle?.stop();

    // Clean up
    if (agentIdForCleanup) {
      unregisterAsyncAgent(agentIdForCleanup);
    }
  }
}

/**
 * Check if auto-background should be triggered (after threshold time)
 */
export function getAutoBackgroundMs(): number {
  const envValue = process.env.AUTO_BACKGROUND_THRESHOLD_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Default: 2 seconds
  return 2000;
}

/**
 * Check if agent should be auto-backgrounded based on elapsed time
 */
export function shouldAutoBackground(startedAt: number): boolean {
  const threshold = getAutoBackgroundMs();
  return Date.now() - startedAt > threshold;
}

/**
 * Create a background race promise that resolves when agent completes or threshold exceeded
 */
export function createBackgroundRacePromise<T>(
  agentPromise: Promise<T>,
  startedAt: number,
  thresholdMs: number
): Promise<{ type: 'completed'; result: T } | { type: 'backgrounded' }> {
  const timeoutPromise = new Promise<{ type: 'backgrounded' }>((resolve) => {
    const remaining = thresholdMs - (Date.now() - startedAt);
    setTimeout(() => resolve({ type: 'backgrounded' }), Math.max(0, remaining));
  });

  return Promise.race([
    agentPromise.then((result) => ({ type: 'completed', result } as const)),
    timeoutPromise,
  ]);
}

/**
 * Get all async agents as array
 */
export function getAllAsyncAgents(): AsyncAgentTask[] {
  return Array.from(asyncAgents.values());
}

/**
 * Clear all completed/failed agents
 */
export function clearFinishedAsyncAgents(): void {
  for (const [taskId, task] of asyncAgents) {
    if (task.status !== 'running') {
      unregisterAsyncAgent(taskId);
    }
  }
}