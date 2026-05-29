/**
 * Query Module - Main exports
 */
export {
  QueryEngine,
  createQueryEngine,
} from './QueryEngine.js';
export type {
  QueryConfig,
  QueryContext,
  QueryOptions,
  QueryProgress,
  QueryResult,
  QueryState,
  QueryPhase,
} from './QueryEngine.js';

export { query, queryStream, runQueryLoop } from './query.js';
export type { QueryOptions as QueryFunctionOptions, QueryResult as QueryFunctionResult } from './query.js';

export {
  getQueryConfig,
  updateQueryConfig,
  resetQueryConfig,
  isFeatureEnabled,
  getMaxTurns,
  getMaxTokens,
  getModel,
  getTemperature,
  getCompactThreshold,
  getRecoveryRetries,
  DEFAULT_CONFIG,
} from './config.js';
export type { QueryConfiguration } from './config.js';

export {
  initDependencies,
  addToolResult,
  getToolResult,
  getAllToolResults,
  cacheResult,
  getCachedResult,
  hasCachedResult,
  clearCache,
  clearToolResults,
  clearAll,
  getCacheSize,
  getToolResultCount,
  setMaxCachedResults,
  getDependencies,
} from './deps.js';
export type { QueryDependencies, ToolResultEntry } from './deps.js';

export {
  transition,
  canTransition,
  addTransitionHandler,
  removeTransitionHandler,
  getTransitionHistory,
  clearTransitionHistory,
  getLastTransition,
  getCurrentPhase,
  isTerminalPhase,
  isActivePhase,
} from './transitions.js';
export type { TransitionEvent, TransitionHandler } from './transitions.js';

export {
  getBudget,
  updateBudget,
  setMaxTokens,
  setWarningThreshold,
  setCriticalThreshold,
  checkBudgetLimits,
  getBudgetState,
  recordUsage,
  canProceed,
  getLimitReason,
  resetBudget,
  getBudgetUsageRatio,
  getRemainingTokens,
  getHistory,
} from './tokenBudget.js';
export type { TokenBudget, BudgetState, TokenUsage } from './tokenBudget.js';

export {
  registerStopHook,
  unregisterStopHook,
  registerPreStopHook,
  unregisterPreStopHook,
  executeStopHooks,
  executeStopHooksSync,
  clearStopHooks,
  getStopHookCount,
  getPreStopHookCount,
  createStopContext,
} from './stopHooks.js';
export type { StopHook, StopHookContext, StopReason } from './stopHooks.js';
