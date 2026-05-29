/**
 * Session Environment Variables
 * Manages environment variables specific to a session context
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import logger from './logger.js'

export interface EnvVarEntry {
  key: string
  value: string
  source: 'system' | 'project' | 'session' | 'user'
  isSecret: boolean
  createdAt: string
  updatedAt: string
}

export interface SessionEnvVars {
  sessionId: string
  vars: Map<string, EnvVarEntry>
  inheritedVars: Set<string>
}

const SECRET_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private/i,
  /access[_-]?key/i,
]

function getSessionEnvDir(sessionId: string): string {
  return path.join(os.homedir(), '.config', 'pakalon', 'env', sessionId)
}

function getEnvFilePath(sessionId: string): string {
  return path.join(getSessionEnvDir(sessionId), 'env.json')
}

function isSecretKey(key: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(key))
}

function maskValue(value: string): string {
  if (value.length <= 4) return '****'
  return value.slice(0, 2) + '****' + value.slice(-2)
}

export function createSessionEnvVars(sessionId: string): SessionEnvVars {
  const envVars: SessionEnvVars = {
    sessionId,
    vars: new Map(),
    inheritedVars: new Set(),
  }

  loadSessionEnvVars(envVars)
  inheritSystemEnvVars(envVars)

  return envVars
}

export function loadSessionEnvVars(envVars: SessionEnvVars): void {
  const filePath = getEnvFilePath(envVars.sessionId)
  if (!fs.existsSync(filePath)) return

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Record<string, EnvVarEntry>

    for (const [key, entry] of Object.entries(data)) {
      envVars.vars.set(key, entry)
    }

    logger.debug(`[SessionEnvVars] Loaded ${envVars.vars.size} env vars for session ${envVars.sessionId}`)
  } catch (error) {
    logger.error(`[SessionEnvVars] Failed to load env vars: ${error}`)
  }
}

export function saveSessionEnvVars(envVars: SessionEnvVars): void {
  const envDir = getSessionEnvDir(envVars.sessionId)
  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true })
  }

  const filePath = getEnvFilePath(envVars.sessionId)
  const data: Record<string, EnvVarEntry> = {}

  for (const [key, entry] of envVars.vars.entries()) {
    data[key] = entry
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  logger.debug(`[SessionEnvVars] Saved ${envVars.vars.size} env vars for session ${envVars.sessionId}`)
}

export function setEnvVar(
  envVars: SessionEnvVars,
  key: string,
  value: string,
  source: EnvVarEntry['source'] = 'session',
): void {
  const now = new Date().toISOString()
  const existing = envVars.vars.get(key)

  const entry: EnvVarEntry = {
    key,
    value,
    source,
    isSecret: isSecretKey(key),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  envVars.vars.set(key, entry)
  saveSessionEnvVars(envVars)

  logger.debug(`[SessionEnvVars] Set env var: ${key} (secret: ${entry.isSecret})`)
}

export function getEnvVar(envVars: SessionEnvVars, key: string): string | undefined {
  const entry = envVars.vars.get(key)
  if (entry) return entry.value

  if (envVars.inheritedVars.has(key)) {
    return process.env[key]
  }

  return undefined
}

export function removeEnvVar(envVars: SessionEnvVars, key: string): boolean {
  const deleted = envVars.vars.delete(key)
  if (deleted) {
    saveSessionEnvVars(envVars)
    logger.debug(`[SessionEnvVars] Removed env var: ${key}`)
  }
  return deleted
}

export function listEnvVars(envVars: SessionEnvVars, includeSecrets = false): EnvVarEntry[] {
  const entries: EnvVarEntry[] = []

  for (const entry of envVars.vars.values()) {
    if (entry.isSecret && !includeSecrets) {
      entries.push({
        ...entry,
        value: maskValue(entry.value),
      })
    } else {
      entries.push({ ...entry })
    }
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

export function getEnvVarKeys(envVars: SessionEnvVars): string[] {
  return Array.from(envVars.vars.keys()).sort()
}

function inheritSystemEnvVars(envVars: SessionEnvVars): void {
  const inheritKeys = [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'LC_ALL',
    'TERM',
    'SHELL',
    'EDITOR',
    'VISUAL',
    'NODE_ENV',
    'NODE_PATH',
    'TMPDIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'GIT_EDITOR',
    'GIT_SSH',
    'SSH_AUTH_SOCK',
  ]

  for (const key of inheritKeys) {
    if (process.env[key] !== undefined) {
      envVars.inheritedVars.add(key)
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PAKALON_') && value !== undefined) {
      envVars.inheritedVars.add(key)
    }
  }
}

export function getEnvForProcess(envVars: SessionEnvVars): Record<string, string> {
  const env: Record<string, string> = { ...process.env }

  for (const [key, entry] of envVars.vars.entries()) {
    env[key] = entry.value
  }

  return env
}

export function exportEnvVarsToFile(
  envVars: SessionEnvVars,
  filePath: string,
  format: 'dotenv' | 'json' | 'shell' = 'dotenv',
): void {
  let content = ''

  switch (format) {
    case 'dotenv':
      for (const entry of envVars.vars.values()) {
        if (!entry.isSecret) {
          const escapedValue = entry.value.replace(/"/g, '\\"')
          content += `${entry.key}="${escapedValue}"\n`
        }
      }
      break

    case 'json':
      const data: Record<string, string> = {}
      for (const entry of envVars.vars.values()) {
        if (!entry.isSecret) {
          data[entry.key] = entry.value
        }
      }
      content = JSON.stringify(data, null, 2)
      break

    case 'shell':
      for (const entry of envVars.vars.values()) {
        if (!entry.isSecret) {
          const escapedValue = entry.value.replace(/'/g, "'\\''")
          content += `export ${entry.key}='${escapedValue}'\n`
        }
      }
      break
  }

  fs.writeFileSync(filePath, content, 'utf-8')
  logger.info(`[SessionEnvVars] Exported env vars to ${filePath} (${format})`)
}

export function importEnvVarsFromFile(
  envVars: SessionEnvVars,
  filePath: string,
  source: EnvVarEntry['source'] = 'project',
): number {
  if (!fs.existsSync(filePath)) {
    logger.warn(`[SessionEnvVars] File not found: ${filePath}`)
    return 0
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const ext = path.extname(filePath).toLowerCase()
  let imported = 0

  if (ext === '.json') {
    const data = JSON.parse(content) as Record<string, string>
    for (const [key, value] of Object.entries(data)) {
      setEnvVar(envVars, key, value, source)
      imported++
    }
  } else {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/) ||
                    trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (match) {
        const key = match[1]!
        let value = match[2]!

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }

        setEnvVar(envVars, key, value, source)
        imported++
      }
    }
  }

  logger.info(`[SessionEnvVars] Imported ${imported} env vars from ${filePath}`)
  return imported
}
