export namespace Token {
  const CHARS_PER_TOKEN = 4

  /**
   * Estimates token count from text using an improved heuristic.
   * - Natural language: ~4 chars per token
   * - Code/punctuation: ~3 chars per token (higher token density)
   * - Whitespace: minimal token cost
   * 
   * This is more accurate than simple length/4 for mixed content like code.
   */
  export function estimate(input: string): number {
    if (!input) return 0
    const trimmed = input.trim()
    if (!trimmed) return 0

    // Base estimate on text length
    const baseTokens = trimmed.length / CHARS_PER_TOKEN

    // Code and punctuation have higher token density (~3 chars/token)
    // Count punctuation/special chars and apply a small adjustment
    const punctMatch = trimmed.match(/[{}()[\];,._+=\-*/&|<>!@#$%^~`?:"'\\]/g)
    const punctuationChars = punctMatch ? punctMatch.length : 0
    const codeAdjustment = punctuationChars * 0.05

    // Long runs of whitespace are cheap tokens
    const whitespaceMatch = trimmed.match(/\s+/g)
    const whitespaceChars = whitespaceMatch ? whitespaceMatch.reduce((sum, w) => sum + w.length, 0) : 0
    const whitespaceAdjustment = Math.max(0, (whitespaceChars / CHARS_PER_TOKEN) * 0.3 - (whitespaceChars / CHARS_PER_TOKEN))

    return Math.max(1, Math.round(baseTokens + codeAdjustment - whitespaceAdjustment))
  }

  /**
   * Conservative estimate for large content - caps estimation to avoid overcounting
   * very large tool outputs or file contents.
   */
  export function estimateCapped(input: string, maxChars: number = 5000): number {
    if (!input) return 0
    const capped = input.length > maxChars ? input.slice(0, maxChars) : input
    return estimate(capped) + Math.round((input.length - capped.length) / CHARS_PER_TOKEN)
  }
}
