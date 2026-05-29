/**
 * Debug Logging Utilities
 *
 * Provides debug logging functionality for the plugin system.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogOptions {
  level?: LogLevel
  pluginId?: string
  [key: string]: unknown
}

const DEBUG_ENABLED = process.env.DEBUG?.includes('plugin') ?? false
const VERBOSE_DEBUG = process.env.DEBUG?.includes('plugin:verbose') ?? false

export function logForDebugging(message: string, options?: LogOptions): void {
  const level = options?.level ?? 'debug'
  const timestamp = new Date().toISOString()
  const pluginId = options?.pluginId ? `[${options.pluginId}]` : ''

  const formattedMessage = `[${timestamp}] ${pluginId} ${message}`

  switch (level) {
    case 'debug':
      if (DEBUG_ENABLED) {
        console.debug(formattedMessage)
      }
      break
    case 'info':
      console.info(formattedMessage)
      break
    case 'warn':
      console.warn(formattedMessage)
      break
    case 'error':
      console.error(formattedMessage)
      break
  }

  if (VERBOSE_DEBUG && options) {
    console.debug('Options:', JSON.stringify(options, null, 2))
  }
}

export function createDebugLogger(module: string) {
  return (message: string, options?: LogOptions) => {
    logForDebugging(`[${module}] ${message}`, options)
  }
}

export function isDebugEnabled(): boolean {
  return DEBUG_ENABLED
}

export function isVerboseDebugEnabled(): boolean {
  return VERBOSE_DEBUG
}

export class DebugLogger {
  constructor(private module: string) {}

  debug(message: string, options?: LogOptions): void {
    logForDebugging(`[${this.module}] ${message}`, { ...options, level: 'debug' })
  }

  info(message: string, options?: LogOptions): void {
    logForDebugging(`[${this.module}] ${message}`, { ...options, level: 'info' })
  }

  warn(message: string, options?: LogOptions): void {
    logForDebugging(`[${this.module}] ${message}`, { ...options, level: 'warn' })
  }

  error(message: string, options?: LogOptions): void {
    logForDebugging(`[${this.module}] ${message}`, { ...options, level: 'error' })
  }
}