/**
 * Team Memory Operations
 *
 * Utility functions for performing operations on team memory files,
 * including merge, diff, validation, and cleanup operations.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import logger from '../../utils/logger.js'

export interface MemoryOperationResult {
  success: boolean
  message: string
  affectedFiles: string[]
}

export interface MemoryMergeOptions {
  strategy: 'append' | 'prepend' | 'replace' | 'deduplicate'
  separator?: string
  dedupKey?: (line: string) => string
}

export interface MemoryDiffResult {
  added: string[]
  removed: string[]
  modified: Array<{ path: string; before: string; after: string }>
}

export async function mergeMemoryFiles(
  sourcePaths: string[],
  targetPath: string,
  options: MemoryMergeOptions = { strategy: 'append' },
): Promise<MemoryOperationResult> {
  const affectedFiles: string[] = []

  try {
    const contents = await Promise.all(
      sourcePaths.map(async (p) => {
        try {
          const content = await fs.readFile(p, 'utf-8')
          affectedFiles.push(p)
          return content
        } catch {
          logger.warn('[team-memory-ops] Failed to read file for merge', { path: p })
          return ''
        }
      }),
    )

    let merged = ''
    const separator = options.separator ?? '\n\n---\n\n'

    switch (options.strategy) {
      case 'append':
        merged = contents.filter(Boolean).join(separator)
        break

      case 'prepend':
        merged = contents.filter(Boolean).reverse().join(separator)
        break

      case 'replace':
        merged = contents.filter(Boolean).pop() ?? ''
        break

      case 'deduplicate': {
        const seen = new Set<string>()
        const keyFn = options.dedupKey ?? ((line: string) => line.trim())

        for (const content of contents) {
          if (!content) continue
          const lines = content.split('\n')
          for (const line of lines) {
            const key = keyFn(line)
            if (key && !seen.has(key)) {
              seen.add(key)
            }
          }
        }

        merged = Array.from(seen).join('\n')
        break
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, merged, 'utf-8')
    affectedFiles.push(targetPath)

    logger.info('[team-memory-ops] Merge complete', {
      strategy: options.strategy,
      files: affectedFiles.length,
    })

    return {
      success: true,
      message: `Merged ${sourcePaths.length} files into ${targetPath}`,
      affectedFiles,
    }
  } catch (error) {
    logger.error('[team-memory-ops] Merge failed', { error: String(error) })
    return {
      success: false,
      message: `Merge failed: ${error}`,
      affectedFiles,
    }
  }
}

export async function diffMemoryFiles(
  pathA: string,
  pathB: string,
): Promise<MemoryDiffResult> {
  const result: MemoryDiffResult = {
    added: [],
    removed: [],
    modified: [],
  }

  try {
    const [contentA, contentB] = await Promise.all([
      fs.readFile(pathA, 'utf-8').catch(() => ''),
      fs.readFile(pathB, 'utf-8').catch(() => ''),
    ])

    const linesA = contentA.split('\n').filter(Boolean)
    const linesB = contentB.split('\n').filter(Boolean)

    const setA = new Set(linesA)
    const setB = new Set(linesB)

    for (const line of linesB) {
      if (!setA.has(line)) {
        result.added.push(line)
      }
    }

    for (const line of linesA) {
      if (!setB.has(line)) {
        result.removed.push(line)
      }
    }

    if (contentA !== contentB) {
      result.modified.push({
        path: pathB,
        before: contentA,
        after: contentB,
      })
    }
  } catch (error) {
    logger.error('[team-memory-ops] Diff failed', { error: String(error) })
  }

  return result
}

export async function validateMemoryFile(
  filePath: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = []

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const stats = await fs.stat(filePath)

    if (stats.size === 0) {
      errors.push('File is empty')
    }

    if (stats.size > 10 * 1024 * 1024) {
      errors.push('File exceeds 10MB size limit')
    }

    if (!content.trim()) {
      errors.push('File contains only whitespace')
    }

    const hasMarkdownExt = /\.(md|markdown|txt)$/i.test(filePath)
    if (!hasMarkdownExt) {
      errors.push('File does not have a recognized memory file extension')
    }

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (frontmatterMatch) {
      try {
        const frontmatter = frontmatterMatch[1]
        if (frontmatter.includes('\t')) {
          errors.push('Frontmatter contains tabs (use spaces)')
        }
      } catch {
        errors.push('Invalid frontmatter format')
      }
    }
  } catch (error) {
    errors.push(`Cannot read file: ${error}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export async function cleanupMemoryFiles(
  directory: string,
  options: {
    maxAgeDays?: number
    maxSizeMB?: number
    dryRun?: boolean
  } = {},
): Promise<MemoryOperationResult> {
  const {
    maxAgeDays = 90,
    maxSizeMB = 50,
    dryRun = false,
  } = options

  const affectedFiles: string[] = []
  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const maxSizeBytes = maxSizeMB * 1024 * 1024

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(md|markdown|txt)$/i.test(entry.name)) continue

      const filePath = path.join(directory, entry.name)
      const stats = await fs.stat(filePath)

      const isExpired = now - stats.mtimeMs > maxAgeMs
      const isOversized = stats.size > maxSizeBytes

      if (isExpired || isOversized) {
        affectedFiles.push(filePath)

        if (!dryRun) {
          await fs.unlink(filePath)
          logger.info('[team-memory-ops] Cleaned up file', {
            path: filePath,
            reason: isExpired ? 'expired' : 'oversized',
          })
        }
      }
    }

    return {
      success: true,
      message: dryRun
        ? `Found ${affectedFiles.length} files to clean`
        : `Cleaned up ${affectedFiles.length} files`,
      affectedFiles,
    }
  } catch (error) {
    logger.error('[team-memory-ops] Cleanup failed', { error: String(error) })
    return {
      success: false,
      message: `Cleanup failed: ${error}`,
      affectedFiles,
    }
  }
}

export async function getMemoryFileStats(
  directory: string,
): Promise<{
  totalFiles: number
  totalSize: number
  oldestFile: { path: string; mtime: number } | null
  newestFile: { path: string; mtime: number } | null
  avgSize: number
}> {
  let totalFiles = 0
  let totalSize = 0
  let oldestFile: { path: string; mtime: number } | null = null
  let newestFile: { path: string; mtime: number } | null = null

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(md|markdown|txt)$/i.test(entry.name)) continue

      const filePath = path.join(directory, entry.name)
      const stats = await fs.stat(filePath)

      totalFiles++
      totalSize += stats.size

      if (!oldestFile || stats.mtimeMs < oldestFile.mtime) {
        oldestFile = { path: filePath, mtime: stats.mtimeMs }
      }
      if (!newestFile || stats.mtimeMs > newestFile.mtime) {
        newestFile = { path: filePath, mtime: stats.mtimeMs }
      }
    }
  } catch (error) {
    logger.error('[team-memory-ops] Stats failed', { error: String(error) })
  }

  return {
    totalFiles,
    totalSize,
    oldestFile,
    newestFile,
    avgSize: totalFiles > 0 ? totalSize / totalFiles : 0,
  }
}
