/**
 * Team Memory Paths
 *
 * Resolves and manages paths for team memory files across different
 * project structures and configurations.
 */

import * as path from 'path'
import * as os from 'os'
import logger from '../../utils/logger.js'

export interface TeamMemPathConfig {
  projectRoot: string
  teamDir?: string
  globalDir?: string
  envPrefix?: string
}

const DEFAULT_TEAM_DIR = '.pakalon/team-memory'
const DEFAULT_GLOBAL_DIR = path.join(
  os.homedir(),
  '.config',
  'pakalon',
  'team-memory',
)

export function getTeamMemPaths(
  projectRoot: string,
  config: Partial<TeamMemPathConfig> = {},
): string[] {
  const merged = {
    projectRoot,
    teamDir: config.teamDir ?? DEFAULT_TEAM_DIR,
    globalDir: config.globalDir ?? DEFAULT_GLOBAL_DIR,
    envPrefix: config.envPrefix ?? 'PAKALON',
  }

  const paths: string[] = []

  const teamDir = path.isAbsolute(merged.teamDir)
    ? merged.teamDir
    : path.join(merged.projectRoot, merged.teamDir)

  paths.push(teamDir)

  if (merged.globalDir) {
    paths.push(merged.globalDir)
  }

  const envPath = process.env[`${merged.envPrefix}_TEAM_MEM_PATH`]
  if (envPath) {
    paths.push(envPath)
  }

  const workspaceRoot = findWorkspaceRoot(merged.projectRoot)
  if (workspaceRoot && workspaceRoot !== merged.projectRoot) {
    paths.push(path.join(workspaceRoot, merged.teamDir))
  }

  return [...new Set(paths)]
}

export function resolveTeamMemPath(
  projectRoot: string,
  relativePath: string,
  config: Partial<TeamMemPathConfig> = {},
): string {
  const paths = getTeamMemPaths(projectRoot, config)

  for (const basePath of paths) {
    const fullPath = path.join(basePath, relativePath)
    if (path.isAbsolute(fullPath)) {
      return fullPath
    }
  }

  return path.join(paths[0] ?? projectRoot, relativePath)
}

export function getTeamMemPathForScope(
  scope: 'project' | 'workspace' | 'global',
  projectRoot: string,
  config: Partial<TeamMemPathConfig> = {},
): string {
  const paths = getTeamMemPaths(projectRoot, config)

  switch (scope) {
    case 'project':
      return paths[0] ?? path.join(projectRoot, DEFAULT_TEAM_DIR)
    case 'workspace': {
      const workspaceRoot = findWorkspaceRoot(projectRoot)
      return workspaceRoot
        ? path.join(workspaceRoot, DEFAULT_TEAM_DIR)
        : paths[0] ?? path.join(projectRoot, DEFAULT_TEAM_DIR)
    }
    case 'global':
      return paths.find(p => p.includes('.config')) ?? DEFAULT_GLOBAL_DIR
  }
}

export function isTeamMemPath(
  filePath: string,
  projectRoot: string,
  config: Partial<TeamMemPathConfig> = {},
): boolean {
  const paths = getTeamMemPaths(projectRoot, config)
  const normalized = path.resolve(filePath)

  return paths.some(p => {
    const resolved = path.resolve(p)
    return normalized.startsWith(resolved)
  })
}

export function getRelativeTeamMemPath(
  filePath: string,
  projectRoot: string,
  config: Partial<TeamMemPathConfig> = {},
): string | null {
  const paths = getTeamMemPaths(projectRoot, config)

  for (const basePath of paths) {
    const resolved = path.resolve(basePath)
    if (filePath.startsWith(resolved)) {
      return path.relative(resolved, filePath)
    }
  }

  return null
}

export function findWorkspaceRoot(startDir: string): string | null {
  let current = startDir

  while (current !== path.parse(current).root) {
    const markers = ['package.json', 'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json']

    for (const marker of markers) {
      try {
        const markerPath = path.join(current, marker)
        if (require('fs').existsSync(markerPath)) {
          return current
        }
      } catch {
        continue
      }
    }

    current = path.dirname(current)
  }

  return null
}

export function getTeamMemConfigPath(
  projectRoot: string,
): string {
  return path.join(projectRoot, '.pakalon', 'team-memory.json')
}

export async function loadTeamMemConfig(
  projectRoot: string,
): Promise<TeamMemPathConfig | null> {
  const configPath = getTeamMemConfigPath(projectRoot)

  try {
    const { default: fs } = await import('fs/promises')
    const content = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(content)

    logger.debug('[team-mem-paths] Loaded config', { path: configPath })

    return {
      projectRoot,
      teamDir: config.teamDir,
      globalDir: config.globalDir,
      envPrefix: config.envPrefix,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error('[team-mem-paths] Failed to load config', {
        path: configPath,
        error: String(error),
      })
    }
    return null
  }
}
