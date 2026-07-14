export namespace CompactPaste {
  const DEFAULT_THRESHOLD = 500

  export interface CompactResult {
    compacted: boolean
    original: string
    summary: string
    lineCount: number
    charCount: number
  }

  export function compact(text: string, threshold?: number): CompactResult {
    const limit = threshold ?? DEFAULT_THRESHOLD
    const charCount = text.length
    const lineCount = text.split("\n").length

    if (charCount <= limit) {
      return {
        compacted: false,
        original: text,
        summary: text,
        lineCount,
        charCount,
      }
    }

    // Create a compact summary
    const lines = text.split("\n")
    const preview = lines.slice(0, 3).join("\n")
    const truncated = lines.length > 6

    let summary = ""
    if (truncated) {
      const middle = Math.floor(lines.length / 2)
      summary = [
        preview,
        "",
        `... (${lines.length - 6} more lines, ${charCount} chars total) ...`,
        "",
        lines.slice(-3).join("\n"),
      ].join("\n")
    } else {
      summary = preview + `\n\n... (${charCount - preview.length} more chars) ...`
    }

    // Check if it looks like code (has common code patterns)
    const codePatterns = /^\s*(function|class|import|export|const|let|var|if|for|while|return|def |fn |pub |private )/m
    const isCode = codePatterns.test(text)

    if (isCode) {
      const fileExt = detectFileType(text)
      summary = `[Pasted ${fileExt} code: ${lineCount} lines, ${charCount} chars]\n\n${summary}`
    } else {
      summary = `[Pasted text: ${lineCount} lines, ${charCount} chars]\n\n${summary}`
    }

    return {
      compacted: true,
      original: text,
      summary,
      lineCount,
      charCount,
    }
  }

  function detectFileType(text: string): string {
    if (/\b(import|export|const|let|function|=>)\b/.test(text)) return "JavaScript/TypeScript"
    if (/\b(def|class|import|from|if __name__)\b/.test(text)) return "Python"
    if (/\b(fn|let mut|pub |impl |struct |enum |use )\b/.test(text)) return "Rust"
    if (/\b(func|package|import|defer|go )\b/.test(text)) return "Go"
    if (/^\s*<[a-z]+[\s>]/im.test(text)) return "HTML"
    if (/^\s*\{[\s\S]*\}\s*$/.test(text) && /"\w+":\s/.test(text)) return "JSON"
    if (/^\s*\w+:\s/.test(text) && !/[{}]/.test(text)) return "YAML"
    if (/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b/i.test(text)) return "SQL"
    if (/^\s*(#|\/\/|\/\*)/.test(text)) return "code"
    return "text"
  }

  export function formatSummary(result: CompactResult): string {
    if (!result.compacted) return result.original
    return result.summary
  }
}
