/**
 * Extract Memories Service
 *
 * Extracts structured memory entries from text content, code files,
 * and conversation logs. Identifies patterns that should be preserved
 * as project memory.
 */

import logger from '../../utils/logger.js'

export interface ExtractedMemory {
  content: string
  category: MemoryCategory
  source: string
  confidence: number
  timestamp?: number
}

export type MemoryCategory =
  | 'architecture'
  | 'convention'
  | 'decision'
  | 'preference'
  | 'pattern'
  | 'configuration'
  | 'dependency'
  | 'environment'

const CATEGORY_PATTERNS: Record<MemoryCategory, RegExp[]> = {
  architecture: [
    /(?:architecture|architectural)\s+(?:decision|pattern|design)/i,
    /(?:system|app)\s+architecture/i,
    /(?:component|module)\s+hierarchy/i,
  ],
  convention: [
    /(?:coding|naming|file)\s+convention/i,
    /(?:always|never|should)\s+(?:use|follow|avoid)/i,
    /style\s+guide/i,
  ],
  decision: [
    /(?:decision|decided|chose)\s+(?:to|that|on)/i,
    /(?:ADR|architectural decision record)/i,
    /trade[- ]?off/i,
  ],
  preference: [
    /(?:prefer|preferred)\s+(?:using|to use)/i,
    /(?:best practice|recommended)/i,
    /(?:favorite|go-to)\s+(?:library|tool|package)/i,
  ],
  pattern: [
    /(?:design|code|architectural)\s+pattern/i,
    /(?:factory|singleton|observer|middleware)/i,
    /reusable\s+(?:component|function|utility)/i,
  ],
  configuration: [
    /(?:config|configuration|settings)\s+(?:for|of)/i,
    /(?:env|environment)\s+variable/i,
    /(?:setup|initialize|configure)/i,
  ],
  dependency: [
    /(?:dependency|package|library)\s+(?:version|require)/i,
    /(?:npm|yarn|bun|pip)\s+(?:install|add)/i,
    /requires?\s+\S+\s+>=?\s*\d/i,
  ],
  environment: [
    /(?:environment|env|runtime)\s+(?:setup|config|require)/i,
    /(?:node|python|bun|docker)\s+version/i,
    /(?:dev|staging|prod)\s+environment/i,
  ],
}

export function extractMemoriesFromContent(
  content: string,
  sourcePath: string,
  options: {
    minConfidence?: number
    maxEntries?: number
  } = {},
): ExtractedMemory[] {
  const { minConfidence = 0.3, maxEntries = 50 } = options
  const memories: ExtractedMemory[] = []

  try {
    const lines = content.split('\n')
    let currentBlock: string[] = []
    let currentCategory: MemoryCategory | null = null

    for (const line of lines) {
      const categorized = categorizeLine(line)

      if (categorized) {
        if (currentBlock.length > 0 && currentCategory) {
          memories.push(
            createMemoryEntry(currentBlock, currentCategory, sourcePath),
          )
        }
        currentBlock = [line]
        currentCategory = categorized
      } else if (line.trim() && currentBlock.length > 0) {
        currentBlock.push(line)
      } else if (currentBlock.length > 0 && currentCategory) {
        memories.push(
          createMemoryEntry(currentBlock, currentCategory, sourcePath),
        )
        currentBlock = []
        currentCategory = null
      }
    }

    if (currentBlock.length > 0 && currentCategory) {
      memories.push(
        createMemoryEntry(currentBlock, currentCategory, sourcePath),
      )
    }

    const filtered = memories
      .filter(m => m.confidence >= minConfidence)
      .slice(0, maxEntries)

    logger.debug('[extract-memories] Extraction complete', {
      source: sourcePath,
      total: memories.length,
      filtered: filtered.length,
    })

    return filtered
  } catch (error) {
    logger.error('[extract-memories] Extraction failed', {
      source: sourcePath,
      error: String(error),
    })
    return []
  }
}

function categorizeLine(line: string): MemoryCategory | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') && trimmed.length < 10) {
    return null
  }

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return category as MemoryCategory
      }
    }
  }

  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    const content = trimmed.slice(2)
    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return category as MemoryCategory
        }
      }
    }
  }

  return null
}

function createMemoryEntry(
  lines: string[],
  category: MemoryCategory,
  source: string,
): ExtractedMemory {
  const content = lines.join('\n').trim()
  const confidence = calculateConfidence(content, category)

  return {
    content,
    category,
    source,
    confidence,
    timestamp: Date.now(),
  }
}

function calculateConfidence(
  content: string,
  category: MemoryCategory,
): number {
  let score = 0.3

  const wordCount = content.split(/\s+/).length
  if (wordCount > 5) score += 0.2
  if (wordCount > 15) score += 0.1

  if (content.includes('must') || content.includes('should')) {
    score += 0.15
  }

  if (content.includes('because') || content.includes('since')) {
    score += 0.1
  }

  const hasCodeBlock = content.includes('```')
  if (hasCodeBlock) score += 0.05

  const hasExample = /(?:example|e\.g\.|for instance)/i.test(content)
  if (hasExample) score += 0.1

  return Math.min(score, 1.0)
}

export function formatMemoriesAsMarkdown(
  memories: ExtractedMemory[],
  options: {
    includeSource?: boolean
    includeConfidence?: boolean
    groupByCategory?: boolean
  } = {},
): string {
  const {
    includeSource = true,
    includeConfidence = false,
    groupByCategory = true,
  } = options

  if (!groupByCategory) {
    return memories
      .map(m => {
        const meta = [
          includeConfidence ? `confidence: ${(m.confidence * 100).toFixed(0)}%` : null,
          includeSource ? `source: ${m.source}` : null,
        ]
          .filter(Boolean)
          .join(' | ')

        return `## ${m.category}\n${meta ? `<!-- ${meta} -->\n` : ''}${m.content}`
      })
      .join('\n\n')
  }

  const grouped = new Map<MemoryCategory, ExtractedMemory[]>()
  for (const memory of memories) {
    const existing = grouped.get(memory.category) ?? []
    existing.push(memory)
    grouped.set(memory.category, existing)
  }

  const sections: string[] = []
  for (const [category, entries] of grouped) {
    const header = `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`
    const items = entries
      .map(m => {
        const meta = [
          includeConfidence ? `<!-- confidence: ${(m.confidence * 100).toFixed(0)}% -->` : null,
          includeSource ? `<!-- source: ${m.source} -->` : null,
        ]
          .filter(Boolean)
          .join('\n')

        return `${meta ? `${meta}\n` : ''}- ${m.content.replace(/\n/g, '\n  ')}`
      })
      .join('\n\n')

    sections.push(`${header}${items}`)
  }

  return sections.join('\n\n')
}
