export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

export interface ThinkingState {
  isThinking: boolean
  thoughts: string[]
  currentThought: string
  stepCount: number
  budgetUsed: number
}

export interface ThinkingDisplayOptions {
  showSteps?: boolean
  showBudget?: boolean
  prefix?: string
  suffix?: string
  maxLength?: number
}

export interface ThinkingTrigger {
  word: string
  start: number
  end: number
}

export interface ThinkingStats {
  totalThinkingTime: number
  averageStepTime: number
  totalThoughts: number
}