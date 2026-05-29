/**
 * Memory Paths Utilities
 *
 * Provides path resolution for the memory directory system.
 */

import { homedir } from 'os'
import { isAbsolute, join, normalize, sep } from 'path'
import { isEnvTruthy } from '../utils/envUtils.js'
import { getSettingsForSource } from '../utils/settings/settings.js'

const AUTO_MEM_DIRNAME = 'memory'
const AUTO_MEM_ENTRYPOINT_NAME = 'MEMORY.md'

/**
 * Whether auto-memory features are enabled.
 * Enabled by default. Priority chain:
 * 1. CLAUDE_CODE_DISABLE_AUTO_MEMORY env var
 * 2. autoMemoryEnabled in settings.json
 * 3. Default: enabled
 */
export function isAutoMemoryEnabled(): boolean {
  const envVal = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  if (isEnvTruthy(envVal)) {
    return false
  }
  const settings = getSettingsForSource('userSettings')
  if (settings?.autoMemoryEnabled !== undefined) {
    return settings.autoMemoryEnabled === true
  }
  return true
}

/**
 * Returns the base directory for persistent memory storage.
 */
export function getMemoryBaseDir(): string {
  if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
    return process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  }
  return join(homedir(), '.config', 'claude')
}

/**
 * Normalize and validate a candidate auto-memory directory path.
 */
function validateMemoryPath(raw: string | undefined, expandTilde: boolean): string | undefined {
  if (!raw) {
    return undefined
  }
  let candidate = raw
  if (expandTilde && (candidate.startsWith('~/') || candidate.startsWith('~\\'))) {
    const rest = candidate.slice(2)
    const restNorm = normalize(rest || '.')
    if (restNorm === '.' || restNorm === '..') {
      return undefined
    }
    candidate = join(homedir(), rest)
  }
  const normalized = normalize(candidate).replace(/[/\\]+$/, '')
  if (
    !isAbsolute(normalized) ||
    normalized.length < 3 ||
    /^[A-Za-z]:$/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('//') ||
    normalized.includes('\0')
  ) {
    return undefined
  }
  return (normalized + sep).normalize('NFC')
}

/**
 * Settings.json override for the full auto-memory directory path.
 */
function getAutoMemPathSetting(): string | undefined {
  const dir =
    getSettingsForSource('policySettings')?.autoMemoryDirectory ??
    getSettingsForSource('localSettings')?.autoMemoryDirectory ??
    getSettingsForSource('userSettings')?.autoMemoryDirectory
  return validateMemoryPath(dir, true)
}

/**
 * Get the current working directory (project root).
 */
function getProjectRoot(): string {
  return process.cwd()
}

/**
 * Get a sanitized path segment from a directory path.
 */
function sanitizePath(dir: string): string {
  return dir
    .replace(/[^a-zA-Z0-9._\-/\\]/g, '_')
    .replace(/\//g, sep)
    .replace(/\\/g, sep)
}

/**
 * Returns the auto-memory directory path.
 * Shape: <memoryBase>/projects/<sanitized-project-root>/memory/
 */
export function getAutoMemPath(): string {
  const override = getAutoMemPathSetting()
  if (override) {
    return override
  }
  const baseDir = getMemoryBaseDir()
  const projectsDir = join(baseDir, 'projects')
  const projectRoot = sanitizePath(getProjectRoot())
  return (join(projectsDir, projectRoot, AUTO_MEM_DIRNAME) + sep).normalize('NFC')
}

/**
 * Returns the auto-memory entrypoint (MEMORY.md inside the auto-memory dir).
 */
export function getAutoMemEntrypoint(): string {
  return join(getAutoMemPath(), AUTO_MEM_ENTRYPOINT_NAME)
}

/**
 * Check if an absolute path is within the auto-memory directory.
 */
export function isAutoMemPath(absolutePath: string): boolean {
  const normalizedPath = normalize(absolutePath)
  return normalizedPath.startsWith(getAutoMemPath())
}