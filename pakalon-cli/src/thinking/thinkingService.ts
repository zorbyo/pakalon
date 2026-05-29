import type { ThinkingState, ThinkingStats } from './types.js'
import {
  getThinkingConfig,
  isThinkingEnabled,
  isThinkingAdaptive,
  getThinkingBudgetTokens,
} from './thinkingConfig.js'

const DEFAULT_STATE: ThinkingState = {
  isThinking: false,
  thoughts: [],
  currentThought: '',
  stepCount: 0,
  budgetUsed: 0,
}

let globalThinkingState: ThinkingState = { ...DEFAULT_STATE }
let thinkingStartTime: number | null = null

export function getThinkingState(): ThinkingState {
  return { ...globalThinkingState }
}

export function startThinking(): void {
  globalThinkingState = {
    isThinking: true,
    thoughts: [],
    currentThought: '',
    stepCount: 0,
    budgetUsed: 0,
  }
  thinkingStartTime = Date.now()
}

export function stopThinking(): void {
  globalThinkingState.isThinking = false
  thinkingStartTime = null
}

export function addThought(thought: string): void {
  if (!globalThinkingState.isThinking) {
    startThinking()
  }
  globalThinkingState.thoughts.push(thought)
  globalThinkingState.currentThought = thought
  globalThinkingState.stepCount++
  globalThinkingState.budgetUsed += thought.length
}

export function getThinkingContent(): string {
  return globalThinkingState.thoughts.join('\n\n')
}

export function getLastThought(): string {
  return globalThinkingState.currentThought
}

export function resetThinkingState(): void {
  globalThinkingState = { ...DEFAULT_STATE }
  thinkingStartTime = null
}

export function isThinkingBudgetExhausted(): boolean {
  return globalThinkingState.budgetUsed >= getThinkingBudgetTokens()
}

export function isThinkingStepLimitReached(_maxSteps: number): boolean {
  return false
}

export function getThinkingStats(): ThinkingStats {
  const totalThoughts = globalThinkingState.thoughts.length
  const elapsed = thinkingStartTime ? Date.now() - thinkingStartTime : 0
  return {
    totalThinkingTime: elapsed,
    averageStepTime: totalThoughts > 0 ? elapsed / totalThoughts : 0,
    totalThoughts,
  }
}

export function shouldUseThinking(model?: string): boolean {
  if (!isThinkingEnabled()) {
    return false
  }
  if (isThinkingAdaptive() && model) {
    return modelSupportsThinking(model)
  }
  return true
}

export function modelSupportsThinking(model: string): boolean {
  const canonical = model.toLowerCase()
  if (
    canonical.includes('opus-4') ||
    canonical.includes('sonnet-4') ||
    canonical.includes('haiku-4')
  ) {
    return true
  }
  if (
    canonical.includes('claude-3-5-sonnet') ||
    canonical.includes('claude-3-opus')
  ) {
    return true
  }
  return false
}

export function modelSupportsAdaptiveThinking(model: string): boolean {
  const canonical = model.toLowerCase()
  if (canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return true
  }
  if (
    canonical.includes('opus') ||
    canonical.includes('sonnet') ||
    canonical.includes('haiku')
  ) {
    return false
  }
  return true
}

export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

export function findThinkingTriggerPositions(
  text: string,
): Array<{ word: string; start: number; end: number }> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(/\bultrathink\b/gi)
  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }
  return positions
}

export function updateThinkingStateFromAPIResponse(
  thinkingBlockContent: string,
): void {
  if (!globalThinkingState.isThinking) {
    startThinking()
  }
  globalThinkingState.currentThought = thinkingBlockContent
  if (
    thinkingBlockContent &&
    !globalThinkingState.thoughts.includes(thinkingBlockContent)
  ) {
    globalThinkingState.thoughts.push(thinkingBlockContent)
  }
}

export function getThinkingProgress(): {
  stepCount: number
  budgetUsed: number
  budgetLimit: number
  percentComplete: number
} {
  const budgetLimit = getThinkingBudgetTokens()
  const percentComplete = Math.min(
    100,
    (globalThinkingState.budgetUsed / budgetLimit) * 100,
  )
  return {
    stepCount: globalThinkingState.stepCount,
    budgetUsed: globalThinkingState.budgetUsed,
    budgetLimit,
    percentComplete,
  }
}