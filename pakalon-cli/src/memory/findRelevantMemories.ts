/**
 * Find Relevant Memories
 *
 * Find memory files relevant to a query by scanning memory file headers
 * and selecting the most relevant ones.
 */

import { logForDebugging } from '../utils/debug.js'
import {
  formatMemoryManifest,
  type MemoryHeader,
  scanMemoryFiles,
} from './memoryScan.js'

export type RelevantMemory = {
  path: string
  mtimeMs: number
}

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to Claude Code as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful to Claude Code as it processes the user's query (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
`

/**
 * Find memory files relevant to a query.
 *
 * Returns absolute file paths + mtime of the most relevant memories (up to 5).
 * Excludes MEMORY.md (already loaded in system prompt).
 */
export async function findRelevantMemories(
  query: string,
  memoryDir: string,
  signal: AbortSignal,
  alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
  const memories = (await scanMemoryFiles(memoryDir, signal)).filter(
    (m) => !alreadySurfaced.has(m.filePath),
  )
  if (memories.length === 0) {
    return []
  }

  const selectedFilenames = await selectRelevantMemories(query, memories, signal)
  const byFilename = new Map(memories.map((m) => [m.filename, m]))
  const selected = selectedFilenames
    .map((filename) => byFilename.get(filename))
    .filter((m): m is MemoryHeader => m !== undefined)

  return selected.map((m) => ({ path: m.filePath, mtimeMs: m.mtimeMs }))
}

async function selectRelevantMemories(
  query: string,
  memories: MemoryHeader[],
  signal: AbortSignal,
): Promise<string[]> {
  const validFilenames = new Set(memories.map((m) => m.filename))
  const manifest = formatMemoryManifest(memories)

  try {
    // Simple keyword-based selection as fallback (no external AI call)
    const queryWords = query.toLowerCase().split(/\s+/)
    const scored = memories.map((m) => {
      const filename = m.filename.toLowerCase()
      const description = (m.description || '').toLowerCase()
      let score = 0
      for (const word of queryWords) {
        if (filename.includes(word)) score += 2
        if (description.includes(word)) score += 1
      }
      return { filename: m.filename, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.filter((s) => s.score > 0).slice(0, 5).map((s) => s.filename)
  } catch (e) {
    if (signal.aborted) {
      return []
    }
    logForDebugging(`[memdir] selectRelevantMemories failed: ${String(e)}`, { level: 'warn' })
    return []
  }
}