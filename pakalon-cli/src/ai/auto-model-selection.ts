/**
 * Auto Model Selection
 *
 * Context-aware optimal model picking based on:
 * - Task complexity
 * - Available context window
 * - Cost optimization
 * - User preferences
 * - Model capabilities
 */

import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelInfo {
  /** Model ID */
  id: string;
  /** Model name */
  name: string;
  /** Context window size */
  contextLength: number;
  /** Cost per 1M input tokens */
  inputCost: number;
  /** Cost per 1M output tokens */
  outputCost: number;
  /** Model capabilities */
  capabilities: ModelCapability[];
  /** Model tier */
  tier: 'free' | 'paid';
  /** Provider */
  provider: string;
}

export type ModelCapability =
  | 'chat'
  | 'completion'
  | 'code'
  | 'reasoning'
  | 'vision'
  | 'function_calling'
  | 'streaming';

export interface TaskContext {
  /** Task type */
  type: 'chat' | 'code' | 'reasoning' | 'analysis' | 'creative';
  /** Estimated token usage */
  estimatedTokens: number;
  /** Requires vision */
  requiresVision?: boolean;
  /** Requires function calling */
  requiresFunctionCalling?: boolean;
  /** Priority */
  priority?: 'speed' | 'quality' | 'cost';
  /** Max budget */
  maxBudget?: number;
}

export interface ModelSelection {
  /** Selected model */
  model: ModelInfo;
  /** Reason for selection */
  reason: string;
  /** Estimated cost */
  estimatedCost: number;
  /** Alternative models */
  alternatives: ModelInfo[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const availableModels: ModelInfo[] = [];
let userPreferences: {
  preferredModels?: string[];
  excludedModels?: string[];
  defaultPriority?: TaskContext['priority'];
} = {};

// ---------------------------------------------------------------------------
// Model Management
// ---------------------------------------------------------------------------

/**
 * Register available models
 */
export function registerModels(models: ModelInfo[]): void {
  availableModels.length = 0;
  availableModels.push(...models);
  logger.info(`[auto-model] Registered ${models.length} models`);
}

/**
 * Add a model
 */
export function addModel(model: ModelInfo): void {
  const existing = availableModels.findIndex((m) => m.id === model.id);
  if (existing >= 0) {
    availableModels[existing] = model;
  } else {
    availableModels.push(model);
  }
  logger.debug(`[auto-model] Added model: ${model.id}`);
}

/**
 * Get all models
 */
export function getModels(): ModelInfo[] {
  return [...availableModels];
}

/**
 * Get models by capability
 */
export function getModelsByCapability(capability: ModelCapability): ModelInfo[] {
  return availableModels.filter((m) => m.capabilities.includes(capability));
}

/**
 * Get models by tier
 */
export function getModelsByTier(tier: ModelInfo['tier']): ModelInfo[] {
  return availableModels.filter((m) => m.tier === tier);
}

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

/**
 * Set user preferences
 */
export function setUserPreferences(preferences: typeof userPreferences): void {
  userPreferences = { ...userPreferences, ...preferences };
  logger.info('[auto-model] Updated user preferences');
}

/**
 * Get user preferences
 */
export function getUserPreferences(): typeof userPreferences {
  return { ...userPreferences };
}

// ---------------------------------------------------------------------------
// Model Selection
// ---------------------------------------------------------------------------

/**
 * Select the best model for a task
 */
export function selectModel(context: TaskContext): ModelSelection {
  // Filter models based on requirements
  let candidates = availableModels.filter((model) => {
    // Check context window
    if (model.contextLength < context.estimatedTokens) {
      return false;
    }

    // Check vision capability
    if (context.requiresVision && !model.capabilities.includes('vision')) {
      return false;
    }

    // Check function calling capability
    if (context.requiresFunctionCalling && !model.capabilities.includes('function_calling')) {
      return false;
    }

    // Check budget
    if (context.maxBudget) {
      const estimatedCost = calculateCost(model, context.estimatedTokens);
      if (estimatedCost > context.maxBudget) {
        return false;
      }
    }

    // Check excluded models
    if (userPreferences.excludedModels?.includes(model.id)) {
      return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    // Fallback to any available model
    candidates = availableModels;
  }

  // Sort by priority
  const priority = context.priority ?? userPreferences.defaultPriority ?? 'quality';
  candidates.sort((a, b) => compareModels(a, b, priority, context));

  // Check preferred models
  if (userPreferences.preferredModels) {
    for (const preferredId of userPreferences.preferredModels) {
      const preferred = candidates.find((m) => m.id === preferredId);
      if (preferred) {
        return {
          model: preferred,
          reason: `Selected preferred model: ${preferred.name}`,
          estimatedCost: calculateCost(preferred, context.estimatedTokens),
          alternatives: candidates.filter((m) => m.id !== preferred.id).slice(0, 3),
        };
      }
    }
  }

  // Select best candidate
  const selected = candidates[0];
  return {
    model: selected,
    reason: `Best match for ${context.type} task (${priority} priority)`,
    estimatedCost: calculateCost(selected, context.estimatedTokens),
    alternatives: candidates.slice(1, 4),
  };
}

/**
 * Compare two models for sorting
 */
function compareModels(
  a: ModelInfo,
  b: ModelInfo,
  priority: TaskContext['priority'],
  context: TaskContext,
): number {
  switch (priority) {
    case 'speed':
      // Prefer smaller, faster models
      return a.contextLength - b.contextLength;

    case 'cost':
      // Prefer cheaper models
      return a.inputCost - b.inputCost;

    case 'quality':
    default:
      // Prefer larger, more capable models
      return b.contextLength - a.contextLength;
  }
}

/**
 * Calculate estimated cost
 */
function calculateCost(model: ModelInfo, tokens: number): number {
  const inputCost = (tokens / 1_000_000) * model.inputCost;
  const outputCost = (tokens / 1_000_000) * model.outputCost;
  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Detect task type from prompt
 */
export function detectTaskType(prompt: string): TaskContext['type'] {
  const lower = prompt.toLowerCase();

  if (/\b(code|function|class|implement|fix|debug|refactor)\b/.test(lower)) {
    return 'code';
  }

  if (/\b(analyze|explain|compare|evaluate|reason)\b/.test(lower)) {
    return 'analysis';
  }

  if (/\b(write|create|generate|story|poem|creative)\b/.test(lower)) {
    return 'creative';
  }

  if (/\b(think|reason|solve|logic|math)\b/.test(lower)) {
    return 'reasoning';
  }

  return 'chat';
}

/**
 * Estimate token usage
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

/**
 * Get model recommendations for a prompt
 */
export function getModelRecommendations(
  prompt: string,
  maxRecommendations: number = 3,
): ModelSelection[] {
  const taskType = detectTaskType(prompt);
  const estimatedTokens = estimateTokens(prompt);

  const context: TaskContext = {
    type: taskType,
    estimatedTokens,
  };

  const selection = selectModel(context);
  return [selection, ...selection.alternatives.slice(0, maxRecommendations - 1).map((model) => ({
    model,
    reason: `Alternative for ${taskType} task`,
    estimatedCost: calculateCost(model, estimatedTokens),
    alternatives: [],
  }))];
}
