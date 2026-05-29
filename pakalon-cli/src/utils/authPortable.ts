/**
 * Portable auth — cross-machine token transfer and validation.
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export interface PortableAuthRecord {
  token: string
  userId: string
  plan: string
  githubLogin?: string
  displayName?: string
  exportedAt: string
  expiresAt: number
  machineId: string
  signature: string
}

export interface PortableAuthExport {
  version: 1
  record: PortableAuthRecord
}

function getSecretKey(): string {
  const envKey = process.env.PAKALON_PORTABLE_AUTH_KEY
  if (envKey) return envKey

  const defaultKey = 'pakalon-portable-auth-default-key-change-in-production'
  return defaultKey
}

function signRecord(record: Omit<PortableAuthRecord, 'signature'>): string {
  const payload = JSON.stringify(record)
  const key = getSecretKey()
  return crypto.createHmac('sha256', key).update(payload).digest('hex')
}

function verifySignature(record: PortableAuthRecord): boolean {
  const { signature, ...data } = record
  const expected = signRecord(data)
  return signature === expected
}

export function exportPortableAuth(
  token: string,
  userId: string,
  plan: string,
  options?: {
    githubLogin?: string
    displayName?: string
    ttlHours?: number
  }
): PortableAuthExport {
  const ttlHours = options?.ttlHours ?? 24
  const now = Date.now()
  const machineId = crypto.randomBytes(16).toString('hex')

  const record: Omit<PortableAuthRecord, 'signature'> = {
    token,
    userId,
    plan,
    githubLogin: options?.githubLogin,
    displayName: options?.displayName,
    exportedAt: new Date().toISOString(),
    expiresAt: now + ttlHours * 60 * 60 * 1000,
    machineId,
  }

  return {
    version: 1,
    record: {
      ...record,
      signature: signRecord(record),
    },
  }
}

export function importPortableAuth(exportData: PortableAuthExport): PortableAuthRecord | null {
  if (exportData.version !== 1) return null

  const record = exportData.record

  if (!verifySignature(record)) return null

  if (Date.now() > record.expiresAt) return null

  return record
}

export function savePortableAuthToFile(exportData: PortableAuthExport, filePath: string): void {
  const content = JSON.stringify(exportData, null, 2)
  fs.writeFileSync(filePath, content, { mode: 0o600 })
}

export function loadPortableAuthFromFile(filePath: string): PortableAuthExport | null {
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PortableAuthExport
    return parsed
  } catch {
    return null
  }
}

export function decodeTokenPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1]!, 'base64url').toString()
    return JSON.parse(payload)
  } catch {
    return null
  }
}

export function isTokenExpired(token: string, bufferMs = 5 * 60 * 1000): boolean {
  const payload = decodeTokenPayload(token)
  if (!payload) return true

  const exp = payload.exp as number | undefined
  if (!exp) return true

  return exp * 1000 < Date.now() + bufferMs
}
