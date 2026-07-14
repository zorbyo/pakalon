import { Token } from "./token"

/**
 * TokenBudgetEngine - Efficient token usage management system
 * 
 * This engine prevents excessive token consumption by:
 * 1. Budget allocation and tracking
 * 2. Smart context compaction triggers
 * 3. Token density analysis for efficient prompting
 * 4. Budget recovery and optimization
 */
export namespace TokenBudgetEngine {
  // Budget allocation: 80% for conversation, 20% reserved for responses
  const CONVERSATION_BUDGET_PCT = 0.80
  const RESERVE_BUDGET_PCT = 0.20
  
  // Trigger compaction at 75% of conversation budget
  const COMPACTION_THRESHOLD_PCT = 0.75
  
  // Maximum tokens per message to prevent oversized inputs
  const MAX_MESSAGE_TOKENS = 2000

  export interface BudgetState {
    totalBudget: number
    usedTokens: number
    reservedTokens: number
    remainingTokens: number
    usagePercent: number
    shouldCompact: boolean
    shouldWarn: boolean
  }

  export interface MessageBudget {
    maxTokens: number
    estimatedTokens: number
    tokenDensity: number // chars per token ratio
  }

  /**
   * Calculate budget state from context limit and current usage
   */
  export function calculateBudget(
    contextLimit: number,
    currentUsage: number,
  ): BudgetState {
    const conversationBudget = Math.floor(contextLimit * CONVERSATION_BUDGET_PCT)
    const reservedTokens = Math.floor(contextLimit * RESERVE_BUDGET_PCT)
    const usedTokens = Math.min(currentUsage, conversationBudget)
    const remainingTokens = Math.max(0, conversationBudget - usedTokens)
    const usagePercent = conversationBudget > 0
      ? Math.round((usedTokens / conversationBudget) * 100)
      : 0

    return {
      totalBudget: contextLimit,
      usedTokens,
      reservedTokens,
      remainingTokens,
      usagePercent,
      shouldCompact: usagePercent >= COMPACTION_THRESHOLD_PCT * 100,
      shouldWarn: usagePercent >= 90,
    }
  }

  /**
   * Analyze message token density to optimize token usage
   * Returns recommendations for more efficient prompting
   */
  export function analyzeMessageEfficiency(
    text: string,
  ): MessageBudget & { recommendations: string[] } {
    const estimatedTokens = Token.estimate(text)
    const tokenDensity = text.length / Math.max(1, estimatedTokens)
    const maxTokens = MAX_MESSAGE_TOKENS
    const recommendations: string[] = []

    // Check for inefficient token usage patterns
    if (tokenDensity < 2.5) {
      recommendations.push("High token density detected - consider simplifying language")
    }
    
    if (estimatedTokens > maxTokens * 0.5) {
      recommendations.push(`Message is ${estimatedTokens} tokens - consider breaking into smaller parts`)
    }

    // Check for repeated content (wastes tokens)
    const lines = text.split('\n')
    const uniqueLines = new Set(lines)
    if (uniqueLines.size < lines.length * 0.7) {
      recommendations.push("Significant repetition detected - remove duplicate content")
    }

    // Check for verbose whitespace
    const whitespaceRatio = (text.match(/\s/g) || []).length / text.length
    if (whitespaceRatio > 0.4) {
      recommendations.push("Excessive whitespace - normalize spacing to save tokens")
    }

    return {
      maxTokens,
      estimatedTokens,
      tokenDensity,
      recommendations,
    }
  }

  /**
   * Estimate tokens for a conversation history efficiently
   * Uses incremental counting instead of full re-estimation
   */
  export function estimateConversationTokens(
    messages: Array<{ role: string; content?: string; tokens?: { input?: number; output?: number; reasoning?: number } }>,
  ): { total: number; breakdown: { input: number; output: number; reasoning: number } } {
    let input = 0
    let output = 0
    let reasoning = 0

    // Find last assistant message with input tokens to use as base
    let lastAssistantIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].tokens?.input) {
        lastAssistantIndex = i
        input = messages[i].tokens!.input!
        break
      }
    }

    // Count outputs from all assistant messages after the base
    // and from user messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === "assistant") {
        // Only add output/reasoning, not input (to avoid double-counting)
        output += msg.tokens?.output ?? 0
        reasoning += msg.tokens?.reasoning ?? 0
      } else if (i > lastAssistantIndex) {
        // User messages after the last tracked assistant
        const content = msg.content || ""
        input += Token.estimate(content)
      }
    }

    return {
      total: input + output + reasoning,
      breakdown: { input, output, reasoning },
    }
  }

  /**
   * Compact text content to reduce token count while preserving meaning
   */
  export function compactText(text: string, targetTokens: number): string {
    const currentTokens = Token.estimate(text)
    if (currentTokens <= targetTokens) return text

    // Strategy 1: Remove excessive whitespace
    let compacted = text.replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    compacted = compacted.replace(/[ \t]+/g, ' ') // Normalize spaces

    if (Token.estimate(compacted) <= targetTokens) return compacted

    // Strategy 2: Remove redundant lines
    const lines = compacted.split('\n')
    const seen = new Set<string>()
    const uniqueLines: string[] = []
    for (const line of lines) {
      const normalized = line.trim().toLowerCase()
      if (!normalized || !seen.has(normalized)) {
        seen.add(normalized)
        uniqueLines.push(line)
      }
    }
    compacted = uniqueLines.join('\n')

    if (Token.estimate(compacted) <= targetTokens) return compacted

    // Strategy 3: Truncate with preservation of first and last portions
    const ratio = targetTokens / Math.max(1, Token.estimate(compacted))
    const keepChars = Math.floor(compacted.length * ratio * 0.9) // Slightly conservative
    const halfKeep = Math.floor(keepChars / 2)
    compacted = compacted.slice(0, halfKeep) + '\n... [truncated] ...\n' + compacted.slice(-halfKeep)

    return compacted
  }

  /**
   * Check if a tool result should be summarized to save tokens
   */
  export function shouldSummarizeToolResult(
    output: string,
    contextBudget: number,
    currentUsage: number,
  ): boolean {
    const resultTokens = Token.estimate(output)
    const budget = calculateBudget(contextBudget, currentUsage)
    
    // Summarize if result is large AND we're approaching budget limits
    if (resultTokens > 500 && budget.usagePercent > 50) return true
    if (resultTokens > 1000) return true
    if (budget.remainingTokens < resultTokens * 2) return true
    
    return false
  }

  /**
   * Get token usage summary for display
   */
  export function getUsageSummary(
    contextLimit: number,
    currentUsage: number,
  ): string {
    const budget = calculateBudget(contextLimit, currentUsage)
    const bars = 20
    const filled = Math.round((budget.usagePercent / 100) * bars)
    const empty = bars - filled
    
    const bar = "█".repeat(filled) + "░".repeat(empty)
    
    if (budget.shouldWarn) {
      return `${bar} ${budget.usagePercent}% (${budget.usedTokens.toLocaleString()}/${budget.totalBudget.toLocaleString()}) ⚠️`
    }
    return `${bar} ${budget.usagePercent}% (${budget.usedTokens.toLocaleString()}/${budget.totalBudget.toLocaleString()})`
  }
}
