import type { ThinkingConfig } from './types.js'
import { getThinkingConfig } from './thinkingConfig.js'

export function getThinkingSystemPrompt(): string {
  return `You have access to extended thinking mode. Use it for complex tasks that require deep reasoning.`
}

export function getThinkingUserMessage(prompt: string): string {
  return prompt
}

export function buildThinkingParams(config: ThinkingConfig): {
  thinking?: { type: 'enabled'; budgetTokens: number }
} {
  if (config.type === 'enabled') {
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: config.budgetTokens,
      },
    }
  }
  if (config.type === 'adaptive') {
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: 16000,
      },
    }
  }
  return {}
}

export function formatThinkingBlock(content: string): string {
  return `<thinking>\n${content}\n</thinking>`
}

export function parseThinkingBlock(text: string): string | null {
  const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/i)
  return match ? match[1].trim() : null
}

export function stripThinkingBlocks(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
}

export function containsThinkingBlock(text: string): boolean {
  return /<thinking>[\s\S]*?<\/thinking>/i.test(text)
}

export function getThinkingInstructions(): string {
  return `When using extended thinking:
- Break down complex problems into steps
- Consider multiple approaches before deciding
- Verify your reasoning at each step
- Document your thought process clearly

Use the thinking block to show your work.`
}

export function shouldIncludeThinkingInPrompt(userMessage: string): boolean {
  const config = getThinkingConfig()
  if (config.type === 'disabled') {
    return false
  }
  const complexKeywords = [
    'analyze',
    'explain',
    'debug',
    'design',
    'architecture',
    'complex',
    'difficult',
    'multiple',
  ]
  const messageLower = userMessage.toLowerCase()
  return complexKeywords.some(keyword => messageLower.includes(keyword))
}

export function getThinkingBudgetDescription(config: ThinkingConfig): string {
  if (config.type === 'adaptive') {
    return 'Adaptive thinking enabled (budget adjusts based on task complexity)'
  }
  if (config.type === 'enabled') {
    return `Extended thinking enabled with ${config.budgetTokens.toLocaleString()} token budget`
  }
  return 'Thinking disabled'
}

export function createThinkingToggleCommand(
  enabled: boolean,
): { command: string; description: string } {
  if (enabled) {
    return {
      command: '/th on',
      description: 'Enable extended thinking',
    }
  }
  return {
    command: '/th off',
    description: 'Disable extended thinking',
  }
}

export function parseThinkingToggleCommand(input: string): {
  action: 'enable' | 'disable' | 'toggle' | null
} {
  const normalized = input.trim().toLowerCase()
  if (normalized === '/th on' || normalized === 'th on') {
    return { action: 'enable' }
  }
  if (normalized === '/th off' || normalized === 'th off') {
    return { action: 'disable' }
  }
  if (normalized === '/th' || normalized === 'th') {
    return { action: 'toggle' }
  }
  return { action: null }
}

export function formatThinkingForAPI(config: ThinkingConfig): Record<string, unknown> {
  if (config.type === 'disabled') {
    return {}
  }
  if (config.type === 'adaptive') {
    return {
      thinking: {
        type: 'enabled',
        budgetTokens: 16000,
      },
    }
  }
  return {
    thinking: {
      type: 'enabled',
      budgetTokens: config.budgetTokens,
    },
  }
}

export function getEffortLevel(prompt: string): 'low' | 'medium' | 'high' {
  const promptLower = prompt.toLowerCase()
  if (/\bultrathink\b/i.test(prompt)) {
    return 'high'
  }
  if (
    promptLower.includes('quick') ||
    promptLower.includes('simple') ||
    promptLower.includes('brief')
  ) {
    return 'low'
  }
  return 'medium'
}