/**
 * Session URL
 * Generates and parses URLs for sharing and accessing sessions
 */

import * as crypto from 'crypto'
import logger from './logger.js'

export interface SessionUrlParams {
  sessionId: string
  baseUrl?: string
  includeAuth?: boolean
  authToken?: string
  expiresInSeconds?: number
}

export interface ParsedSessionUrl {
  sessionId: string
  baseUrl: string
  authToken?: string
  expiresAt?: Date
  isValid: boolean
  error?: string
}

export interface SessionUrlOptions {
  protocol?: 'https' | 'http'
  port?: number
  path?: string
  queryParams?: Record<string, string>
}

const DEFAULT_BASE_URL = 'https://pakalon.com'
const URL_VERSION = 'v1'

export function generateSessionUrl(params: SessionUrlParams): string {
  const {
    sessionId,
    baseUrl = DEFAULT_BASE_URL,
    includeAuth = false,
    authToken,
    expiresInSeconds,
  } = params

  if (!sessionId) {
    throw new Error('Session ID is required')
  }

  const url = new URL(baseUrl)
  url.pathname = `/session/${sessionId}`

  const queryParams: Record<string, string> = {
    v: URL_VERSION,
    sid: encodeSessionId(sessionId),
  }

  if (expiresInSeconds) {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
    queryParams.exp = expiresAt.toISOString()
  }

  if (includeAuth && authToken) {
    queryParams.token = authToken
  }

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value)
  }

  const fullUrl = url.toString()
  logger.debug(`[SessionUrl] Generated URL for session ${sessionId}`)

  return fullUrl
}

export function generateShareableSessionUrl(
  sessionId: string,
  options?: {
    baseUrl?: string
    expiresInSeconds?: number
    title?: string
  },
): string {
  const {
    baseUrl = DEFAULT_BASE_URL,
    expiresInSeconds = 3600,
    title,
  } = options || {}

  const url = new URL(baseUrl)
  url.pathname = `/share/${sessionId}`

  const queryParams: Record<string, string> = {
    v: URL_VERSION,
    sid: encodeSessionId(sessionId),
    exp: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  }

  if (title) {
    queryParams.t = title
  }

  const shareToken = generateShareToken(sessionId, expiresInSeconds)
  queryParams.st = shareToken

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value)
  }

  logger.info(`[SessionUrl] Generated shareable URL for session ${sessionId}`)

  return url.toString()
}

export function parseSessionUrl(urlString: string): ParsedSessionUrl {
  try {
    const url = new URL(urlString)

    const sessionId = url.searchParams.get('sid')
    if (!sessionId) {
      return {
        sessionId: '',
        baseUrl: urlString,
        isValid: false,
        error: 'Missing session ID parameter',
      }
    }

    const decodedSessionId = decodeSessionId(sessionId)
    const expiresAt = url.searchParams.get('exp')
    const authToken = url.searchParams.get('token')

    if (expiresAt) {
      const expiryDate = new Date(expiresAt)
      if (expiryDate < new Date()) {
        return {
          sessionId: decodedSessionId,
          baseUrl: url.origin,
          expiresAt: expiryDate,
          isValid: false,
          error: 'Session URL has expired',
        }
      }
    }

    return {
      sessionId: decodedSessionId,
      baseUrl: url.origin,
      authToken: authToken || undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      isValid: true,
    }
  } catch (error) {
    return {
      sessionId: '',
      baseUrl: urlString,
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid URL format',
    }
  }
}

export function generateResumeSessionUrl(
  sessionId: string,
  cwd?: string,
  options?: SessionUrlOptions,
): string {
  const {
    protocol = 'https',
    port,
    path = '/resume',
    queryParams = {},
  } = options || {}

  const baseUrl = port
    ? `${protocol}://pakalon.com:${port}`
    : `${protocol}://pakalon.com`

  const url = new URL(path, baseUrl)

  url.searchParams.set('sid', sessionId)
  url.searchParams.set('v', URL_VERSION)

  if (cwd) {
    url.searchParams.set('cwd', cwd)
  }

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value)
  }

  logger.debug(`[SessionUrl] Generated resume URL for session ${sessionId}`)

  return url.toString()
}

export function generateDeepLink(sessionId: string, action?: string): string {
  const url = new URL(`pakalon://session/${sessionId}`)

  if (action) {
    url.searchParams.set('action', action)
  }

  return url.toString()
}

export function isValidSessionUrl(urlString: string): boolean {
  const parsed = parseSessionUrl(urlString)
  return parsed.isValid
}

export function extractSessionIdFromUrl(urlString: string): string | null {
  const parsed = parseSessionUrl(urlString)
  return parsed.isValid ? parsed.sessionId : null
}

function encodeSessionId(sessionId: string): string {
  try {
    return Buffer.from(sessionId).toString('base64url')
  } catch {
    return sessionId
  }
}

function decodeSessionId(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf-8')
  } catch {
    return encoded
  }
}

function generateShareToken(sessionId: string, expiresInSeconds: number): string {
  const data = `${sessionId}:${expiresInSeconds}:${Date.now()}`
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16)
}

export function getSessionUrlFromId(sessionId: string): string {
  return `${DEFAULT_BASE_URL}/session/${sessionId}`
}

export function formatSessionUrlForDisplay(url: string, maxLength: number = 50): string {
  if (url.length <= maxLength) return url

  try {
    const parsed = new URL(url)
    const path = parsed.pathname + parsed.search

    if (path.length <= maxLength - parsed.origin.length - 3) {
      return `${parsed.origin}...${path}`
    }

    return `${parsed.origin}${path.slice(0, maxLength - parsed.origin.length - 3)}...`
  } catch {
    return url.slice(0, maxLength - 3) + '...'
  }
}
