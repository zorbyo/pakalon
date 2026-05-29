import type { ThinkingConfig } from './types.js'

const DEFAULT_ADAPTIVE_BUDGET_TOKENS = 16000

const DEFAULT_EXPLICIT_BUDGET_TOKENS = 10000

const DEFAULT_THINKING_CONFIG: ThinkingConfig = {
  type: 'disabled',
}

let globalThinkingConfig: ThinkingConfig = { ...DEFAULT_THINKING_CONFIG }

export function getThinkingConfig(): ThinkingConfig {
  return { ...globalThinkingConfig }
}

export function setThinkingConfig(config: ThinkingConfig): void {
  globalThinkingConfig = config
}

export function isThinkingEnabled(): boolean {
  const config = globalThinkingConfig
  return config.type === 'enabled' || config.type === 'adaptive'
}

export function isThinkingAdaptive(): boolean {
  return globalThinkingConfig.type === 'adaptive'
}

export function getThinkingBudgetTokens(): number {
  const config = globalThinkingConfig
  if (config.type === 'enabled') {
    return config.budgetTokens
  }
  return DEFAULT_EXPLICIT_BUDGET_TOKENS
}

export function enableThinking(budgetTokens?: number): void {
  globalThinkingConfig = {
    type: 'enabled',
    budgetTokens: budgetTokens ?? DEFAULT_EXPLICIT_BUDGET_TOKENS,
  }
}

export function enableAdaptiveThinking(): void {
  globalThinkingConfig = { type: 'adaptive' }
}

export function disableThinking(): void {
  globalThinkingConfig = { type: 'disabled' }
}

export function shouldEnableThinkingByDefault(): boolean {
  if (typeof process !== 'undefined' && process.env?.MAX_THINKING_TOKENS) {
    const tokens = parseInt(process.env.MAX_THINKING_TOKENS, 10)
    if (!isNaN(tokens)) {
      return tokens > 0
    }
  }
  return true
}

export function createThinkingConfigFromOptions(options: {
  thinking?: 'adaptive' | 'enabled' | 'disabled'
  maxThinkingTokens?: number
}): ThinkingConfig {
  if (options.thinking === 'adaptive' || options.thinking === 'enabled') {
    return { type: 'adaptive' }
  }

  if (options.thinking === 'disabled') {
    return { type: 'disabled' }
  }

  if (options.maxThinkingTokens !== undefined) {
    if (options.maxThinkingTokens > 0) {
      return {
        type: 'enabled',
        budgetTokens: options.maxThinkingTokens,
      }
    }
    return { type: 'disabled' }
  }

  return shouldEnableThinkingByDefault() ? { type: 'adaptive' } : { type: 'disabled' }
}

export function parseThinkingBudgetFromEnv(): number | undefined {
  if (typeof process !== 'undefined' && process.env?.MAX_THINKING_TOKENS) {
    const tokens = parseInt(process.env.MAX_THINKING_TOKENS, 10)
    if (!isNaN(tokens)) {
      return tokens
    }
  }
  return undefined
}

export function getAdaptiveBudgetTokens(): number {
  return DEFAULT_ADAPTIVE_BUDGET_TOKENS
}

export function isValidThinkingConfig(config: unknown): config is ThinkingConfig {
  if (!config || typeof config !== 'object') {
    return false
  }
  const c = config as Record<string, unknown>
  if (c.type === 'adaptive') {
    return true
  }
  if (c.type === 'enabled') {
    return typeof c.budgetTokens === 'number' && c.budgetTokens > 0
  }
  if (c.type === 'disabled') {
    return true
  }
  return false
}