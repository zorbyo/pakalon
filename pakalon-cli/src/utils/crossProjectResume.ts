/**
 * Cross-Project Resume
 * Enables resuming Pakalon sessions across different project directories
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
import logger from './logger.js'
import { getSessionId, setSessionId } from '../bootstrap/state.js'

export interface ProjectContext {
  projectRoot: string
  projectName: string
  lastSessionId?: string
  lastActiveAt?: string
  configPath: string
}

export interface CrossProjectSession {
  id: string
  projectRoot: string
  projectName: string
  originalSessionId: string
  createdAt: string
  lastResumedAt?: string
  messageCount: number
  model?: string
  agentId?: string
}

const PAKALON_CONFIG_DIR = '.pakalon'
const SESSION_REGISTRY_FILE = 'session-registry.json'

function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'pakalon')
}

function getSessionRegistryPath(): string {
  return path.join(getConfigDir(), SESSION_REGISTRY_FILE)
}

function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
}

function readSessionRegistry(): Record<string, CrossProjectSession> {
  const registryPath = getSessionRegistryPath()
  if (!fs.existsSync(registryPath)) {
    return {}
  }

  try {
    const raw = fs.readFileSync(registryPath, 'utf-8')
    return JSON.parse(raw) as Record<string, CrossProjectSession>
  } catch {
    return {}
  }
}

function writeSessionRegistry(registry: Record<string, CrossProjectSession>): void {
  ensureConfigDir()
  const registryPath = getSessionRegistryPath()
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8')
}

export function detectProjectRoot(cwd?: string): string {
  const startDir = cwd || process.cwd()
  let current = startDir

  while (true) {
    const pakalonConfig = path.join(current, PAKALON_CONFIG_DIR, 'plan.md')
    const gitDir = path.join(current, '.git')
    const packageJson = path.join(current, 'package.json')

    if (fs.existsSync(pakalonConfig)) {
      return current
    }

    if (fs.existsSync(gitDir)) {
      return current
    }

    if (fs.existsSync(packageJson)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return startDir
}

export function getProjectName(projectRoot: string): string {
  return path.basename(projectRoot)
}

export function getProjectContext(cwd?: string): ProjectContext {
  const projectRoot = detectProjectRoot(cwd)
  const projectName = getProjectName(projectRoot)
  const configPath = path.join(projectRoot, PAKALON_CONFIG_DIR)

  const registry = readSessionRegistry()
  const lastSession = Object.values(registry).find(
    s => s.projectRoot === projectRoot,
  )

  return {
    projectRoot,
    projectName,
    lastSessionId: lastSession?.originalSessionId,
    lastActiveAt: lastSession?.lastResumedAt,
    configPath,
  }
}

export async function resumeProjectSession(
  projectRoot: string,
  options?: { model?: string; agentId?: string },
): Promise<CrossProjectSession | null> {
  const registry = readSessionRegistry()
  const projectSessions = Object.values(registry)
    .filter(s => s.projectRoot === projectRoot)
    .sort((a, b) => new Date(b.lastResumedAt || b.createdAt).getTime() - new Date(a.lastResumedAt || a.createdAt).getTime())

  if (projectSessions.length === 0) {
    logger.info(`[CrossProjectResume] No previous sessions found for ${projectRoot}`)
    return null
  }

  const lastSession = projectSessions[0]!

  lastSession.lastResumedAt = new Date().toISOString()
  registry[lastSession.id] = lastSession
  writeSessionRegistry(registry)

  setSessionId(lastSession.originalSessionId)

  logger.info(`[CrossProjectResume] Resumed session ${lastSession.originalSessionId} for project ${projectRoot}`)

  return lastSession
}

export function registerSession(
  projectRoot: string,
  sessionId?: string,
  options?: { model?: string; agentId?: string; messageCount?: number },
): CrossProjectSession {
  const projectName = getProjectName(projectRoot)
  const id = randomUUID()
  const actualSessionId = sessionId || getSessionId()

  const session: CrossProjectSession = {
    id,
    projectRoot,
    projectName,
    originalSessionId: actualSessionId,
    createdAt: new Date().toISOString(),
    messageCount: options?.messageCount || 0,
    model: options?.model,
    agentId: options?.agentId,
  }

  const registry = readSessionRegistry()
  registry[id] = session
  writeSessionRegistry(registry)

  logger.debug(`[CrossProjectResume] Registered session ${id} for project ${projectRoot}`)

  return session
}

export function updateSessionActivity(sessionId: string): void {
  const registry = readSessionRegistry()
  const session = registry[sessionId]
  if (session) {
    session.lastResumedAt = new Date().toISOString()
    registry[sessionId] = session
    writeSessionRegistry(registry)
  }
}

export function listProjectSessions(projectRoot: string): CrossProjectSession[] {
  const registry = readSessionRegistry()
  return Object.values(registry)
    .filter(s => s.projectRoot === projectRoot)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function listAllProjects(): ProjectContext[] {
  const registry = readSessionRegistry()
  const projectMap = new Map<string, CrossProjectSession>()

  for (const session of Object.values(registry)) {
    if (!projectMap.has(session.projectRoot)) {
      projectMap.set(session.projectRoot, session)
    }
  }

  return Array.from(projectMap.values()).map(session => ({
    projectRoot: session.projectRoot,
    projectName: session.projectName,
    lastSessionId: session.originalSessionId,
    lastActiveAt: session.lastResumedAt || session.createdAt,
    configPath: path.join(session.projectRoot, PAKALON_CONFIG_DIR),
  }))
}

export function clearProjectSessions(projectRoot: string): void {
  const registry = readSessionRegistry()
  const newRegistry = Object.fromEntries(
    Object.entries(registry).filter(([, s]) => s.projectRoot !== projectRoot),
  )
  writeSessionRegistry(newRegistry)
  logger.info(`[CrossProjectResume] Cleared all sessions for project ${projectRoot}`)
}

export function getSessionByProjectAndId(
  projectRoot: string,
  sessionId: string,
): CrossProjectSession | undefined {
  const registry = readSessionRegistry()
  return Object.values(registry).find(
    s => s.projectRoot === projectRoot && s.originalSessionId === sessionId,
  )
}
