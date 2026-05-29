import { getClaudeAIOAuthTokens } from '../utils/auth.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'

export type FinalizeSource = 'no_data_timeout' | 'close_event' | 'explicit'

export interface VoiceStreamConnection {
  send: (chunk: Buffer) => void
  close: () => void
  finalize: () => Promise<FinalizeSource | undefined>
}

export interface VoiceStreamCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onError: (error: string, opts?: { fatal?: boolean }) => void
  onClose: () => void
  onReady: (conn: VoiceStreamConnection) => void
}

export interface VoiceStreamOptions {
  language: string
  keyterms: string[]
}

interface InternalConnection extends VoiceStreamConnection {
  isStale: () => boolean
}

const VOICE_STREAM_URL = 'wss://claude.ai/api/voice_stream'

let cachedToken: string | null = null
let cachedTokenExpiry = 0

function getAccessToken(): string | null {
  const now = Date.now()
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken
  }
  const tokens = getClaudeAIOAuthTokens()
  if (tokens?.accessToken) {
    cachedToken = tokens.accessToken
    cachedTokenExpiry = now + 50 * 60 * 1000 // 50 min
    return cachedToken
  }
  return null
}

export function isVoiceStreamAvailable(): boolean {
  return getAccessToken() !== null
}

export async function connectVoiceStream(
  callbacks: VoiceStreamCallbacks,
  options: VoiceStreamOptions,
): Promise<VoiceStreamConnection | null> {
  const token = getAccessToken()
  if (!token) {
    logForDebugging('[voiceStreamSTT] No access token available')
    return null
  }

  const url = new URL(VOICE_STREAM_URL)
  url.searchParams.set('language', options.language)
  if (options.keyterms.length > 0) {
    url.searchParams.set('keyterms', options.keyterms.join(','))
  }

  let ws: WebSocket | null = null
  let isStale = false
  let finalizeResolver: ((source: FinalizeSource | undefined) => void) | null = null
  let finalizePromise: Promise<FinalizeSource | undefined>

  function createFinalizePromise(): Promise<FinalizeSource | undefined> {
    finalizePromise = new Promise<FinalizeSource | undefined>(resolve => {
      finalizeResolver = resolve
    })
    return finalizePromise
  }

  createFinalizePromise()

  const noDataTimeout = setTimeout(() => {
    if (finalizeResolver && !isStale) {
      finalizeResolver('no_data_timeout')
    }
  }, 15_000)

  try {
    ws = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'pakalon-cli/1.0.0',
      },
    })

    const conn: InternalConnection = {
      send: (chunk: Buffer) => {
        if (isStale || !ws || ws.readyState !== WebSocket.OPEN) return
        try {
          ws.send(chunk)
        } catch (err) {
          logForDebugging(`[voiceStreamSTT] send error: ${err}`)
        }
      },
      close: () => {
        isStale = true
        if (ws) {
          try {
            ws.close()
          } catch {
            // Ignore
          }
          ws = null
        }
      },
      finalize: () => {
        if (isStale) return Promise.resolve(undefined)
        isStale = true
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'finalize' }))
          } catch {
            // Ignore
          }
        }
        clearTimeout(noDataTimeout)
        return finalizePromise
      },
      isStale: () => isStale,
    }

    ws.onopen = () => {
      logForDebugging('[voiceStreamSTT] WebSocket connected')
      callbacks.onReady(conn)
    }

    ws.onmessage = (event: { data: unknown }) => {
      if (isStale) return
      try {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>
        const type = data.type as string | undefined

        if (type === 'transcript') {
          const text = (data.text as string) ?? ''
          const isFinal = (data.is_final as boolean) ?? false
          if (text) {
            callbacks.onTranscript(text, isFinal)
          }
        } else if (type === 'error') {
          const message = (data.message as string) ?? 'Unknown error'
          const fatal = (data.fatal as boolean) ?? false
          callbacks.onError(message, { fatal })
        } else if (type === 'ready') {
          // Server acknowledgment
        }
      } catch (err) {
        logForDebugging(`[voiceStreamSTT] message parse error: ${err}`)
      }
    }

    ws.onerror = (event: unknown) => {
      if (isStale) return
      logForDebugging(`[voiceStreamSTT] WebSocket error: ${JSON.stringify(event)}`)
      callbacks.onError('WebSocket connection error')
    }

    ws.onclose = (event: { code?: number; reason?: string }) => {
      if (isStale) {
        callbacks.onClose()
        return
      }
      isStale = true
      clearTimeout(noDataTimeout)
      if (finalizeResolver) {
        finalizeResolver('close_event')
      }
      logForDebugging(
        `[voiceStreamSTT] WebSocket closed: code=${event.code ?? 'unknown'} reason=${event.reason ?? ''}`,
      )
      if (event.code === 1008) {
        callbacks.onError('Voice stream rejected: unsupported configuration', { fatal: true })
      } else if (event.code === 1002 || event.code === 1006) {
        callbacks.onError(`Voice stream disconnected (code ${event.code})`)
      }
      callbacks.onClose()
    }
  } catch (err) {
    clearTimeout(noDataTimeout)
    logError(new Error(`[voiceStreamSTT] connection failed: ${err}`))
    callbacks.onError('Failed to establish voice stream connection')
    return null
  }

  return conn
}
