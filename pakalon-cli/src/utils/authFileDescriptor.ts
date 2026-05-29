/**
 * Auth file descriptor — manages file-level auth state tracking.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface AuthFileDescriptor {
  filePath: string
  createdAt: number
  modifiedAt: number
  size: number
  hash: string
}

function getConfigDir(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(configDir, 'pakalon')
}

function getAuthFilePath(): string {
  return path.join(getConfigDir(), 'auth.descriptor.json')
}

function computeHash(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash.toString(36)
}

export function createAuthFileDescriptor(filePath: string): AuthFileDescriptor {
  const stats = fs.statSync(filePath)
  const content = fs.readFileSync(filePath, 'utf-8')

  return {
    filePath,
    createdAt: stats.birthtimeMs,
    modifiedAt: stats.mtimeMs,
    size: stats.size,
    hash: computeHash(content),
  }
}

export function saveAuthFileDescriptor(descriptor: AuthFileDescriptor): void {
  const dir = getConfigDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  fs.writeFileSync(getAuthFilePath(), JSON.stringify(descriptor, null, 2), { mode: 0o600 })
}

export function loadAuthFileDescriptor(): AuthFileDescriptor | null {
  const filePath = getAuthFilePath()
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as AuthFileDescriptor
  } catch {
    return null
  }
}

export function isAuthFileModified(descriptor: AuthFileDescriptor): boolean {
  if (!fs.existsSync(descriptor.filePath)) return true

  const stats = fs.statSync(descriptor.filePath)
  if (stats.mtimeMs > descriptor.modifiedAt) return true
  if (stats.size !== descriptor.size) return true

  const content = fs.readFileSync(descriptor.filePath, 'utf-8')
  return computeHash(content) !== descriptor.hash
}

export function clearAuthFileDescriptor(): void {
  const filePath = getAuthFilePath()
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}
