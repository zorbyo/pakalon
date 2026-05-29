/**
 * Memory File Detection
 *
 * Scans directories to find memory-related files following various
 * conventions (CLAUDE.md, PAKALON.md, .memdir/, etc.).
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import logger from '../../utils/logger.js'

export interface DetectedMemoryFile {
  path: string
  type: MemoryFileType
  depth: number
}

export type MemoryFileType =
  | 'project-root'
  | 'project-dir'
  | 'global'
  | 'team'
  | 'nested'

const MEMORY_FILE_NAMES = new Set([
  'CLAUDE.md',
  'claude.md',
  'PAKALON.md',
  'pakalon.md',
  'MEMORY.md',
  'memory.md',
  'AGENTS.md',
  'agents.md',
])

const MEMORY_DIR_NAMES = new Set([
  '.memdir',
  '.memory',
  '.pakalon',
  '.claude',
  'team-memory',
])

const MAX_SCAN_DEPTH = 5

export async function detectMemoryFiles(
  rootDir: string,
  options: {
    maxDepth?: number
    includeDirs?: boolean
  } = {},
): Promise<DetectedMemoryFile[]> {
  const { maxDepth = MAX_SCAN_DEPTH, includeDirs = true } = options
  const results: DetectedMemoryFile[] = []

  try {
    await scanDirectory(rootDir, rootDir, 0, maxDepth, results, includeDirs)
  } catch (error) {
    logger.error('[memory-detect] Scan failed', {
      rootDir,
      error: String(error),
    })
  }

  return results.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.path.localeCompare(b.path)
  })
}

async function scanDirectory(
  rootDir: string,
  currentDir: string,
  currentDepth: number,
  maxDepth: number,
  results: DetectedMemoryFile[],
  includeDirs: boolean,
): Promise<void> {
  if (currentDepth > maxDepth) return

  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        if (MEMORY_DIR_NAMES.has(entry.name)) {
          if (includeDirs) {
            results.push({
              path: fullPath,
              type: classifyDirType(entry.name, currentDir, rootDir),
              depth: currentDepth,
            })
          }

          await scanDirectory(
            rootDir,
            fullPath,
            currentDepth + 1,
            maxDepth,
            results,
            includeDirs,
          )
        } else if (!entry.name.startsWith('.') || entry.name === '.pakalon') {
          await scanDirectory(
            rootDir,
            fullPath,
            currentDepth + 1,
            maxDepth,
            results,
            includeDirs,
          )
        }
      } else if (entry.isFile() && MEMORY_FILE_NAMES.has(entry.name)) {
        results.push({
          path: fullPath,
          type: classifyFileType(entry.name, currentDir, rootDir),
          depth: currentDepth,
        })
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EACCES') {
      logger.debug('[memory-detect] Failed to read directory', {
        dir: currentDir,
        error: String(error),
      })
    }
  }
}

function classifyFileType(
  fileName: string,
  dirPath: string,
  rootDir: string,
): MemoryFileType {
  const relativeDir = path.relative(rootDir, dirPath)

  if (relativeDir === '' || relativeDir === '.') {
    return 'project-root'
  }

  if (relativeDir.includes('.pakalon') || relativeDir.includes('.claude')) {
    return 'project-dir'
  }

  if (relativeDir.includes('team-memory') || relativeDir.includes('team')) {
    return 'team'
  }

  return 'nested'
}

function classifyDirType(
  dirName: string,
  dirPath: string,
  rootDir: string,
): MemoryFileType {
  const relativeDir = path.relative(rootDir, dirPath)

  if (relativeDir === '' || relativeDir === '.') {
    return 'project-root'
  }

  if (dirName === 'team-memory') {
    return 'team'
  }

  if (dirName.startsWith('.')) {
    return 'project-dir'
  }

  return 'nested'
}

export function isMemoryFile(filePath: string): boolean {
  const baseName = path.basename(filePath)
  return MEMORY_FILE_NAMES.has(baseName)
}

export function isMemoryDirectory(dirName: string): boolean {
  return MEMORY_DIR_NAMES.has(dirName)
}

export function getMemoryFilePriority(filePath: string): number {
  const baseName = path.basename(filePath).toLowerCase()

  switch (baseName) {
    case 'pakalon.md':
    case 'claude.md':
      return 100
    case 'memory.md':
      return 80
    case 'agents.md':
      return 60
    default:
      return 10
  }
}
