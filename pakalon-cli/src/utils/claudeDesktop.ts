/**
 * Claude Desktop Integration — utilities for handoff to Claude Desktop application.
 *
 * Handles session transfer, deep linking, and desktop app detection.
 */

import { execFileNoThrow } from './execFileNoThrow.js'
import { isWindows, isMacOS } from './envUtils.js'

export interface DesktopHandoffConfig {
  sessionId: string
  sessionTitle?: string
  provider: 'pakalon'
}

/**
 * Check if Claude Desktop is installed on the system.
 */
export async function isClaudeDesktopInstalled(): Promise<boolean> {
  if (isMacOS()) {
    try {
      const { code } = await execFileNoThrow('mdfind', [
        'kMDItemCFBundleIdentifier == com.anthropic.clause.desktop',
      ])
      return code === 0
    } catch {
      return false
    }
  }

  if (isWindows()) {
    try {
      const { code } = await execFileNoThrow('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '/s',
        '/f',
        'Claude',
      ])
      return code === 0
    } catch {
      return false
    }
  }

  return false
}

/**
 * Check if Claude Desktop is currently running.
 */
export async function isClaudeDesktopRunning(): Promise<boolean> {
  if (isMacOS()) {
    try {
      const { code, stdout } = await execFileNoThrow('pgrep', [
        '-x',
        'Claude',
      ])
      return code === 0 && !!stdout?.trim()
    } catch {
      return false
    }
  }

  if (isWindows()) {
    try {
      const { code, stdout } = await execFileNoThrow('tasklist', [
        '/FI',
        'IMAGENAME eq Claude.exe',
        '/NH',
      ])
      return !!stdout?.includes('Claude.exe')
    } catch {
      return false
    }
  }

  return false
}

/**
 * Build a deep link URL for opening a session in Claude Desktop.
 */
export function buildDesktopDeepLink(config: DesktopHandoffConfig): string {
  const params = new URLSearchParams({
    sessionId: config.sessionId,
    provider: config.provider,
  })

  if (config.sessionTitle) {
    params.set('title', config.sessionTitle)
  }

  return `claude://session?${params.toString()}`
}

/**
 * Launch Claude Desktop with a session handoff.
 */
export async function launchClaudeDesktop(
  config: DesktopHandoffConfig,
): Promise<{ success: boolean; error?: string }> {
  const url = buildDesktopDeepLink(config)

  if (isMacOS()) {
    try {
      const { code, stderr } = await execFileNoThrow('open', [url])
      if (code === 0) {
        return { success: true }
      }
      return {
        success: false,
        error: stderr || 'Failed to open Claude Desktop',
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to launch Claude Desktop',
      }
    }
  }

  if (isWindows()) {
    try {
      const { code, stderr } = await execFileNoThrow('cmd', [
        '/c',
        'start',
        '',
        url,
      ])
      if (code === 0) {
        return { success: true }
      }
      return {
        success: false,
        error: stderr || 'Failed to open Claude Desktop',
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to launch Claude Desktop',
      }
    }
  }

  return {
    success: false,
    error: 'Claude Desktop is not supported on this platform',
  }
}

/**
 * Get the Claude Desktop application path.
 */
export function getClaudeDesktopPath(): string | null {
  if (isMacOS()) {
    return '/Applications/Claude.app'
  }

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      return `${localAppData}\\Programs\\Claude\\Claude.exe`
    }
  }

  return null
}

/**
 * Check if the current platform supports Claude Desktop handoff.
 */
export function isDesktopHandoffSupported(): boolean {
  return isMacOS() || (isWindows() && process.arch === 'x64')
}

/**
 * Get platform-specific instructions for installing Claude Desktop.
 */
export function getDesktopInstallInstructions(): string {
  if (isMacOS()) {
    return 'Download Claude Desktop from https://claude.ai/download'
  }

  if (isWindows()) {
    return 'Download Claude Desktop from https://claude.ai/download'
  }

  return 'Claude Desktop is only available on macOS and Windows'
}

/**
 * Prepare session data for handoff to Claude Desktop.
 */
export function prepareSessionHandoff(
  sessionId: string,
  sessionTitle?: string,
): DesktopHandoffConfig {
  return {
    sessionId,
    sessionTitle,
    provider: 'pakalon',
  }
}
