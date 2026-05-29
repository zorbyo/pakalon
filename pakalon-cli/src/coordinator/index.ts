/**
 * Coordinator Module - Main Exports
 * 
 * Coordinator Mode enables multi-agent orchestration where a coordinator
 * spawns and manages worker agents to complete tasks in parallel.
 * 
 * Key functions:
 * - isCoordinatorMode(): Check if coordinator mode is enabled
 * - matchSessionMode(): Sync coordinator mode with resumed session
 * - getCoordinatorUserContext(): Provide worker tool context
 * - getCoordinatorSystemPrompt(): Coordinator-specific system prompt
 */

export {
  isCoordinatorMode,
  isCoordinatorFeatureEnabled,
  enableCoordinatorMode,
  disableCoordinatorMode,
  matchSessionMode,
  getCoordinatorUserContext,
  getCoordinatorSystemPrompt,
  getInternalWorkerTools,
  isInternalWorkerTool,
  getVisibleWorkerTools,
  clearFeatureFlagCache,
} from './coordinatorMode.js';

import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  ASYNC_AGENT_ALLOWED_TOOLS,
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
  INTERNAL_WORKER_TOOLS,
  SIMPLE_MODE_WORKER_TOOLS,
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  COORDINATOR_MODE_ENV_VAR,
  COORDINATOR_MODE_FEATURE_FLAG,
} from './constants.js';

export {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  ASYNC_AGENT_ALLOWED_TOOLS,
  ALL_AGENT_DISALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  COORDINATOR_MODE_ALLOWED_TOOLS,
  INTERNAL_WORKER_TOOLS,
  SIMPLE_MODE_WORKER_TOOLS,
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  COORDINATOR_MODE_ENV_VAR,
  COORDINATOR_MODE_FEATURE_FLAG,
};

export type {
  SessionMode,
  CoordinatorModeConfig,
  CoordinatorContext,
  WorkerToolContext,
  TaskNotification,
  WorkerSpawnConfig,
  WorkerCapabilities,
} from './types.js';

const ASYNC_AGENT_ALLOWED_TOOLS_LOCAL = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Bash',
  'Edit',
  'Write',
  'TodoWrite',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
]);

export function getWorkerTools(): string[] {
  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS_LOCAL);
}

export function getCoordinatorTools(): string[] {
  return Array.from(COORDINATOR_MODE_ALLOWED_TOOLS);
}

export function isToolAllowedForWorker(toolName: string): boolean {
  return ASYNC_AGENT_ALLOWED_TOOLS_LOCAL.has(toolName);
}

export function isToolAllowedForCoordinator(toolName: string): boolean {
  return COORDINATOR_MODE_ALLOWED_TOOLS.has(toolName);
}

export function filterToolsForCoordinator(tools: string[]): string[] {
  return tools.filter(tool => isToolAllowedForCoordinator(tool));
}

export function filterToolsForWorker(tools: string[]): string[] {
  return tools.filter(tool => isToolAllowedForWorker(tool));
}