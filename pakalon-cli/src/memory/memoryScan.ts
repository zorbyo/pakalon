/**
 * Memory Scanning Utilities
 *
 * Provides primitives for scanning memory directories.
 */

import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { type MemoryType, parseMemoryType } from './types.js'

export type MemoryHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200
const FRONTMATTER_MAX_LINES = 30

/**
 * Read the frontmatter and mtime from a memory file.
 */
async function readMemoryFileHeader(
  filePath: string,
  signal: AbortSignal,
): Promise<{ mtimeMs: number; description: string | null; type: MemoryType | undefined }> {
  const fs = await import('fs/promises')
  const { mtimeMs } = await fs.stat(filePath)
  const content = await readFileInRange(filePath, 0, FRONTMATTER_MAX_LINES, signal)
  const { frontmatter } = parseFrontmatter(content, filePath)
  return {
    mtimeMs: mtimeMs.getTime(),
    description: frontmatter.description ? String(frontmatter.description) : null,
    type: parseMemoryType(frontmatter.type),
  }
}

/**
 * Read a range of lines from a file.
 */
async function readFileInRange(
  filePath: string,
  startLine: number,
  lineCount: number,
  signal: AbortSignal,
): Promise<string> {
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')
  const lines = content.split('\n')
  return lines.slice(startLine, startLine + lineCount).join('\n')
}

/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES).
 */
export async function scanMemoryFiles(
  memoryDir: string,
  signal: AbortSignal,
): Promise<MemoryHeader[]> {
  try {
    const entries = await readdir(memoryDir, { withFileTypes: true, recursive: true })
    const mdFiles = entries.filter(
      (f) => f.isFile() && f.name.endsWith('.md') && f.name !== 'MEMORY.md',
    )

    const headerResults = await Promise.allSettled(
      mdFiles.map(async (entry): Promise<MemoryHeader> => {
        const relativePath = entry.path ? join(entry.path, entry.name).replace(memoryDir, '') : entry.name
        const filePath = join(memoryDir, relativePath)
        const { mtimeMs, description, type } = await readMemoryFileHeader(filePath, signal)
        return {
          filename: relativePath,
          filePath,
          mtimeMs,
          description,
          type,
        }
      }),
    )

    return headerResults
      .filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES)
  } catch {
    return []
  }
}

/**
 * Format memory headers as a text manifest: one line per file with
 * [type] filename (timestamp): description.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map((m) => {
      const tag = m.type ? `[${m.type}] ` : ''
      const ts = new Date(m.mtimeMs).toISOString()
      return m.description ? `- ${tag}${m.filename} (${ts}): ${m.description}` : `- ${tag}${m.filename} (${ts})`
    })
    .join('\n')
}