export interface AutoModeState {
  disabled: boolean
  enabled: boolean
  lastRunResult: 'allow' | 'ask' | 'deny' | null
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  } | null
}

const DEFAULT_STATE: AutoModeState = {
  disabled: false,
  enabled: false,
  lastRunResult: null,
  usage: null,
}

let state: AutoModeState = { ...DEFAULT_STATE }

export function getAutoModeState(): AutoModeState {
  return { ...state, usage: state.usage ? { ...state.usage } : null }
}

export function setAutoModeState(next: Partial<AutoModeState>): void {
  state = { ...state, ...next }
}

export function resetAutoModeState(): void {
  state = { ...DEFAULT_STATE }
}
