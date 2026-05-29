/**
 * Team Memory Paths
 *
 * Provides path resolution and validation for team memory directory.
 */

import { lstat, realpath } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import { getAutoMemPath, isAutoMemoryEnabled } from './paths.js'

/**
 * Error thrown when a path validation detects a traversal or injection attempt.
 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Whether team memory features are enabled.
 * Team memory is a subdirectory of auto memory, so it requires auto memory
 * to be enabled.
 */
export function isTeamMemoryEnabled(): boolean {
  if (!isAutoMemoryEnabled()) {
    return false
  }
  return process.env.CLAUDE_CODE_TEAM_MEMORY === 'true'
}

/**
 * Returns the team memory path: <autoMemPath>/team/
 */
export function getTeamMemPath(): string {
  return (join(getAutoMemPath(), 'team') + sep).normalize('NFC')
}

/**
 * Returns the team memory entrypoint: <autoMemPath>/team/MEMORY.md
 */
export function getTeamMemEntrypoint(): string {
  return join(getAutoMemPath(), 'team', 'MEMORY.md')
}

/**
 * Resolve symlinks for the deepest existing ancestor of a path.
 */
async function realpathDeepestExisting(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = absolutePath

  for (let parent = dirname(current); current !== parent; parent = dirname(current)) {
    try {
      const realCurrent = await realpath(current)
      return tail.length === 0 ? realCurrent : join(realCurrent, ...tail.reverse())
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        try {
          const st = await lstat(current)
          if (st.isSymbolicLink()) {
            throw new PathTraversalError(`Dangling symlink detected: "${current}"`)
          }
        } catch {}
      } else if (code === 'ELOOP') {
        throw new PathTraversalError(`Symlink loop detected: "${current}"`)
      } else if (code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') {
        throw new PathTraversalError(`Cannot verify path (${code}): "${current}"`)
      }
      tail.push(current.slice(parent.length + sep.length))
      current = parent
    }
  }
  return absolutePath
}

/**
 * Check if a real (symlink-resolved) path is within the real team memory directory.
 */
async function isRealPathWithinTeamDir(realCandidate: string): Promise<boolean> {
  try {
    const realTeamDir = await realpath(getTeamMemPath().replace(/[/\\]+$/, ''))
    if (realCandidate === realTeamDir) return true
    return realCandidate.startsWith(realTeamDir + sep)
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return true
    }
    return false
  }
}

/**
 * Check if a resolved absolute path is within the team memory directory.
 */
export function isTeamMemPath(filePath: string): boolean {
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  return resolvedPath.startsWith(teamDir)
}

/**
 * Validate that an absolute file path is safe for writing to the team memory directory.
 */
export async function validateTeamMemWritePath(filePath: string): Promise<string> {
  if (filePath.includes('\0')) {
    throw new PathTraversalError(`Null byte in path: "${filePath}"`)
  }
  const resolvedPath = resolve(filePath)
  const teamDir = getTeamMemPath()
  if (!resolvedPath.startsWith(teamDir)) {
    throw new PathTraversalError(`Path escapes team memory directory: "${filePath}"`)
  }
  const realPath = await realpathDeepestExisting(resolvedPath)
  if (!(await isRealPathWithinTeamDir(realPath))) {
    throw new PathTraversalError(`Path escapes team memory directory via symlink: "${filePath}"`)
  }
  return resolvedPath
}

/**
 * Check if a file path is within the team memory directory and team memory is enabled.
 */
export function isTeamMemFile(filePath: string): boolean {
  return isTeamMemoryEnabled() && isTeamMemPath(filePath)
}