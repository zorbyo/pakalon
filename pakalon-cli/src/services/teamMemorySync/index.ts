/**
 * Team Memory Sync Service
 *
 * Synchronizes memory files across team members by reading/writing to
 * shared team memory directories. Handles conflict resolution and
 * merge strategies for concurrent edits.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import logger from '../../utils/logger.js'
import { getTeamMemPaths } from '../../memdir/teamMemPaths.js'
import { detectMemoryFiles } from '../../utils/memoryFileDetection.js'

export interface TeamMemorySyncResult {
  synced: number
  conflicts: number
  errors: Array<{ path: string; error: string }>
  timestamp: number
}

export interface TeamMemoryConfig {
  teamDir: string
  mergeStrategy: 'latest-wins' | 'local-wins' | 'remote-wins' | 'manual'
  syncInterval?: number
  excludePatterns?: string[]
}

const DEFAULT_CONFIG: TeamMemoryConfig = {
  teamDir: '.pakalon/team-memory',
  mergeStrategy: 'latest-wins',
  excludePatterns: ['*.tmp', '*.lock'],
}

export async function syncTeamMemory(
  projectRoot: string,
  config?: Partial<TeamMemoryConfig>,
): Promise<TeamMemorySyncResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const result: TeamMemorySyncResult = {
    synced: 0,
    conflicts: 0,
    errors: [],
    timestamp: Date.now(),
  }

  try {
    const teamDir = path.isAbsolute(mergedConfig.teamDir)
      ? mergedConfig.teamDir
      : path.join(projectRoot, mergedConfig.teamDir)

    await fs.mkdir(teamDir, { recursive: true })

    const localFiles = await detectMemoryFiles(projectRoot)
    const teamFiles = await detectMemoryFiles(teamDir)

    const allPaths = new Set([
      ...localFiles.map(f => f.path),
      ...teamFiles.map(f => f.path),
    ])

    for (const filePath of allPaths) {
      try {
        const synced = await syncSingleFile(
          filePath,
          projectRoot,
          teamDir,
          mergedConfig,
        )
        if (synced.conflict) {
          result.conflicts++
        } else if (synced.updated) {
          result.synced++
        }
      } catch (error) {
        result.errors.push({
          path: filePath,
          error: String(error),
        })
        logger.error('[team-memory-sync] Failed to sync file', {
          path: filePath,
          error: String(error),
        })
      }
    }

    logger.info('[team-memory-sync] Sync complete', {
      synced: result.synced,
      conflicts: result.conflicts,
      errors: result.errors.length,
    })
  } catch (error) {
    logger.error('[team-memory-sync] Sync failed', { error: String(error) })
    result.errors.push({
      path: projectRoot,
      error: String(error),
    })
  }

  return result
}

async function syncSingleFile(
  filePath: string,
  projectRoot: string,
  teamDir: string,
  config: TeamMemoryConfig,
): Promise<{ updated: boolean; conflict: boolean }> {
  const relativePath = path.relative(projectRoot, filePath)
  const teamPath = path.join(teamDir, relativePath)

  const [localExists, teamExists] = await Promise.all([
    fileExists(filePath),
    fileExists(teamPath),
  ])

  if (!localExists && !teamExists) {
    return { updated: false, conflict: false }
  }

  if (localExists && !teamExists) {
    await fs.mkdir(path.dirname(teamPath), { recursive: true })
    await fs.copyFile(filePath, teamPath)
    return { updated: true, conflict: false }
  }

  if (!localExists && teamExists) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.copyFile(teamPath, filePath)
    return { updated: true, conflict: false }
  }

  const [localStats, teamStats] = await Promise.all([
    fs.stat(filePath),
    fs.stat(teamPath),
  ])

  const [localContent, teamContent] = await Promise.all([
    fs.readFile(filePath, 'utf-8'),
    fs.readFile(teamPath, 'utf-8'),
  ])

  if (localContent === teamContent) {
    return { updated: false, conflict: false }
  }

  switch (config.mergeStrategy) {
    case 'latest-wins': {
      const winner =
        localStats.mtimeMs >= teamStats.mtimeMs ? filePath : teamPath
      const loser = winner === filePath ? teamPath : filePath
      await fs.copyFile(winner, loser)
      return { updated: true, conflict: true }
    }
    case 'local-wins': {
      await fs.copyFile(filePath, teamPath)
      return { updated: true, conflict: true }
    }
    case 'remote-wins': {
      await fs.copyFile(teamPath, filePath)
      return { updated: true, conflict: true }
    }
    case 'manual':
    default:
      return { updated: false, conflict: true }
  }
}

export async function getTeamMemoryStatus(
  projectRoot: string,
  config?: Partial<TeamMemoryConfig>,
): Promise<{
  localFiles: number
  teamFiles: number
  outOfSync: number
  teamDir: string
}> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  const teamDir = path.isAbsolute(mergedConfig.teamDir)
    ? mergedConfig.teamDir
    : path.join(projectRoot, mergedConfig.teamDir)

  const localFiles = await detectMemoryFiles(projectRoot)
  const teamFiles = await detectMemoryFiles(teamDir)

  let outOfSync = 0
  for (const teamFile of teamFiles) {
    const relativePath = path.relative(teamDir, teamFile.path)
    const localPath = path.join(projectRoot, relativePath)
    const localMatch = localFiles.find(f => f.path === localPath)

    if (!localMatch) {
      outOfSync++
      continue
    }

    const [localContent, teamContent] = await Promise.all([
      fs.readFile(localPath, 'utf-8'),
      fs.readFile(teamFile.path, 'utf-8'),
    ])

    if (localContent !== teamContent) {
      outOfSync++
    }
  }

  return {
    localFiles: localFiles.length,
    teamFiles: teamFiles.length,
    outOfSync,
    teamDir,
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
