/**
 * Portable Session Storage
 * Export and import session data in a portable format for cross-machine transfer
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import logger from './logger.js'

export interface PortableSessionData {
  version: number
  exportedAt: string
  sessionId: string
  metadata: SessionMetadata
  messages: PortableMessage[]
  context: SessionContext
  settings: SessionSettings
  checksum: string
}

export interface SessionMetadata {
  title?: string
  createdAt: string
  updatedAt: string
  model?: string
  agentId?: string
  projectRoot?: string
  messageCount: number
  tokenUsage?: number
}

export interface PortableMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | PortableContentBlock[]
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface PortableContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  source?: {
    type: string
    media_type: string
    data: string
  }
  tool?: {
    name: string
    input: Record<string, unknown>
    output?: string
  }
}

export interface SessionContext {
  workingDirectory?: string
  environmentVariables?: Record<string, string>
  gitBranch?: string
  gitCommit?: string
  files?: FileSnapshot[]
}

export interface FileSnapshot {
  path: string
  content: string
  lastModified: string
}

export interface SessionSettings {
  model?: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
  tools?: string[]
}

export interface ExportOptions {
  includeMessages?: boolean
  includeFiles?: boolean
  includeSettings?: boolean
  maxMessages?: number
  compress?: boolean
}

export interface ImportResult {
  success: boolean
  sessionId: string
  messageCount: number
  error?: string
}

const PORTABLE_FORMAT_VERSION = 1
const SESSION_STORAGE_DIR = path.join(os.homedir(), '.config', 'pakalon', 'sessions')

function getSessionFilePath(sessionId: string): string {
  return path.join(SESSION_STORAGE_DIR, `${sessionId}.json`)
}

function getExportFilePath(sessionId: string, exportPath?: string): string {
  if (exportPath) return exportPath
  return path.join(process.cwd(), `pakalon-session-${sessionId}.json`)
}

export async function exportSession(
  sessionId: string,
  options: ExportOptions = {},
): Promise<PortableSessionData> {
  const {
    includeMessages = true,
    includeFiles = false,
    includeSettings = true,
    maxMessages = 1000,
  } = options

  const sessionFilePath = getSessionFilePath(sessionId)
  if (!fs.existsSync(sessionFilePath)) {
    throw new Error(`Session file not found: ${sessionId}`)
  }

  const rawData = fs.readFileSync(sessionFilePath, 'utf-8')
  const sessionData = JSON.parse(rawData) as Record<string, unknown>

  const messages: PortableMessage[] = includeMessages
    ? extractMessages(sessionData, maxMessages)
    : []

  const context: SessionContext = {
    workingDirectory: sessionData.workingDirectory as string | undefined,
    environmentVariables: sessionData.environmentVariables as Record<string, string> | undefined,
    gitBranch: sessionData.gitBranch as string | undefined,
    gitCommit: sessionData.gitCommit as string | undefined,
    files: includeFiles ? extractFileSnapshots(sessionData) : [],
  }

  const settings: SessionSettings = includeSettings
    ? extractSettings(sessionData)
    : {}

  const metadata: SessionMetadata = {
    title: sessionData.title as string | undefined,
    createdAt: sessionData.createdAt as string || new Date().toISOString(),
    updatedAt: sessionData.updatedAt as string || new Date().toISOString(),
    model: sessionData.model as string | undefined,
    agentId: sessionData.agentId as string | undefined,
    projectRoot: sessionData.projectRoot as string | undefined,
    messageCount: messages.length,
    tokenUsage: sessionData.tokenUsage as number | undefined,
  }

  const portableData: PortableSessionData = {
    version: PORTABLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sessionId,
    metadata,
    messages,
    context,
    settings,
    checksum: '',
  }

  portableData.checksum = calculateChecksum(portableData)

  logger.info(`[PortableSessionStorage] Exported session ${sessionId} (${messages.length} messages)`)

  return portableData
}

export async function exportSessionToFile(
  sessionId: string,
  exportPath?: string,
  options: ExportOptions = {},
): Promise<string> {
  const data = await exportSession(sessionId, options)
  const filePath = getExportFilePath(sessionId, exportPath)

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

  logger.info(`[PortableSessionStorage] Exported session to file: ${filePath}`)

  return filePath
}

export async function importSession(
  filePath: string,
  targetSessionId?: string,
): Promise<ImportResult> {
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      sessionId: '',
      messageCount: 0,
      error: `File not found: ${filePath}`,
    }
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as PortableSessionData

    if (data.version !== PORTABLE_FORMAT_VERSION) {
      return {
        success: false,
        sessionId: '',
        messageCount: 0,
        error: `Unsupported format version: ${data.version}`,
      }
    }

    const expectedChecksum = data.checksum
    data.checksum = ''
    const actualChecksum = calculateChecksum(data)
    data.checksum = expectedChecksum

    if (expectedChecksum !== actualChecksum) {
      logger.warn(`[PortableSessionStorage] Checksum mismatch for session ${data.sessionId}`)
    }

    const sessionId = targetSessionId || data.sessionId

    const sessionData = reconstructSession(data, sessionId)
    const sessionFilePath = getSessionFilePath(sessionId)

    if (!fs.existsSync(SESSION_STORAGE_DIR)) {
      fs.mkdirSync(SESSION_STORAGE_DIR, { recursive: true })
    }

    fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2), 'utf-8')

    logger.info(`[PortableSessionStorage] Imported session ${sessionId} (${data.messages.length} messages)`)

    return {
      success: true,
      sessionId,
      messageCount: data.messages.length,
    }
  } catch (error) {
    return {
      success: false,
      sessionId: '',
      messageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export function validatePortableSession(data: PortableSessionData): string[] {
  const errors: string[] = []

  if (!data.version) {
    errors.push('Missing version')
  } else if (data.version !== PORTABLE_FORMAT_VERSION) {
    errors.push(`Unsupported version: ${data.version}`)
  }

  if (!data.sessionId) {
    errors.push('Missing sessionId')
  }

  if (!data.exportedAt) {
    errors.push('Missing exportedAt timestamp')
  }

  if (!data.metadata) {
    errors.push('Missing metadata')
  }

  if (!Array.isArray(data.messages)) {
    errors.push('Messages must be an array')
  }

  if (data.checksum) {
    const expectedChecksum = data.checksum
    data.checksum = ''
    const actualChecksum = calculateChecksum(data)
    data.checksum = expectedChecksum

    if (expectedChecksum !== actualChecksum) {
      errors.push('Checksum mismatch')
    }
  }

  return errors
}

export function listStoredSessions(): Array<{ id: string; path: string; size: number }> {
  if (!fs.existsSync(SESSION_STORAGE_DIR)) {
    return []
  }

  const files = fs.readdirSync(SESSION_STORAGE_DIR).filter(f => f.endsWith('.json'))

  return files.map(file => {
    const filePath = path.join(SESSION_STORAGE_DIR, file)
    const stats = fs.statSync(filePath)
    return {
      id: file.replace('.json', ''),
      path: filePath,
      size: stats.size,
    }
  })
}

export function deleteStoredSession(sessionId: string): boolean {
  const filePath = getSessionFilePath(sessionId)
  if (!fs.existsSync(filePath)) return false

  fs.unlinkSync(filePath)
  logger.info(`[PortableSessionStorage] Deleted stored session ${sessionId}`)
  return true
}

function extractMessages(sessionData: Record<string, unknown>, maxMessages: number): PortableMessage[] {
  const messages = sessionData.messages as Array<Record<string, unknown>> | undefined
  if (!messages) return []

  return messages.slice(-maxMessages).map(msg => ({
    id: msg.id as string || crypto.randomUUID(),
    role: (msg.role as PortableMessage['role']) || 'user',
    content: msg.content as string | PortableContentBlock[],
    timestamp: msg.timestamp as string || new Date().toISOString(),
    metadata: msg.metadata as Record<string, unknown> | undefined,
  }))
}

function extractFileSnapshots(sessionData: Record<string, unknown>): FileSnapshot[] {
  const files = sessionData.files as Array<Record<string, unknown>> | undefined
  if (!files) return []

  return files.map(file => ({
    path: file.path as string,
    content: file.content as string,
    lastModified: file.lastModified as string || new Date().toISOString(),
  }))
}

function extractSettings(sessionData: Record<string, unknown>): SessionSettings {
  return {
    model: sessionData.model as string | undefined,
    temperature: sessionData.temperature as number | undefined,
    maxTokens: sessionData.maxTokens as number | undefined,
    systemPrompt: sessionData.systemPrompt as string | undefined,
    tools: sessionData.tools as string[] | undefined,
  }
}

function reconstructSession(data: PortableSessionData, sessionId: string): Record<string, unknown> {
  return {
    id: sessionId,
    title: data.metadata.title,
    createdAt: data.metadata.createdAt,
    updatedAt: data.metadata.updatedAt,
    model: data.settings.model || data.metadata.model,
    agentId: data.metadata.agentId,
    projectRoot: data.context.workingDirectory || data.metadata.projectRoot,
    messages: data.messages,
    workingDirectory: data.context.workingDirectory,
    environmentVariables: data.context.environmentVariables,
    gitBranch: data.context.gitBranch,
    gitCommit: data.context.gitCommit,
    files: data.context.files,
    settings: data.settings,
    importedAt: new Date().toISOString(),
    originalSessionId: data.sessionId,
  }
}

function calculateChecksum(data: PortableSessionData): string {
  const checksumData = JSON.stringify({
    version: data.version,
    sessionId: data.sessionId,
    exportedAt: data.exportedAt,
    metadata: data.metadata,
    messages: data.messages,
    context: data.context,
    settings: data.settings,
  })

  return crypto.createHash('sha256').update(checksumData).digest('hex').slice(0, 32)
}
