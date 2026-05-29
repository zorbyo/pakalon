/**
 * IDE Path Conversion — handles path translation between different environments.
 *
 * Supports conversion between:
 * - Windows paths (C:\Users\...) and WSL paths (/mnt/c/Users/...)
 * - POSIX paths and IDE-specific path formats
 */

export interface PathConverter {
  toIDEPath(path: string): string
  fromIDEPath(path: string): string
}

/**
 * Converts between Windows and WSL paths.
 *
 * When the IDE runs on Windows but Pakalon runs in WSL,
 * paths need to be translated for the IDE to find files.
 */
export class WindowsToWSLConverter implements PathConverter {
  private distroName: string

  constructor(distroName: string) {
    this.distroName = distroName
  }

  /**
   * Convert a WSL path to a Windows path for the IDE.
   * e.g., /mnt/c/Users/foo/project -> C:\Users\foo\project
   */
  toIDEPath(wslPath: string): string {
    const normalized = wslPath.replace(/\//g, '\\')

    const mntMatch = normalized.match(/^\\\\mnt\\\\([a-zA-Z])\\\\(.*)$/)
    if (mntMatch) {
      const [, drive, rest] = mntMatch
      return `${drive!.toUpperCase()}:\\${rest}`
    }

    return normalized
  }

  /**
   * Convert a Windows path to a WSL path.
   * e.g., C:\Users\foo\project -> /mnt/c/Users/foo/project
   */
  fromIDEPath(windowsPath: string): string {
    const normalized = windowsPath.replace(/\\/g, '/')

    const driveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/)
    if (driveMatch) {
      const [, drive, rest] = driveMatch
      return `/mnt/${drive!.toLowerCase()}/${rest}`
    }

    return normalized
  }
}

/**
 * Converts between macOS and Linux paths (for remote development scenarios).
 */
export class MacOSToLinuxConverter implements PathConverter {
  private remoteBase: string

  constructor(remoteBase: string) {
    this.remoteBase = remoteBase.replace(/\/+$/, '')
  }

  /**
   * Convert a local macOS path to a remote Linux path.
   */
  toIDEPath(localPath: string): string {
    const home = process.env.HOME ?? ''
    if (localPath.startsWith(home)) {
      const relative = localPath.slice(home.length).replace(/^\/+/, '')
      return `${this.remoteBase}/${relative}`
    }
    return localPath
  }

  /**
   * Convert a remote Linux path to a local macOS path.
   */
  fromIDEPath(remotePath: string): string {
    const home = process.env.HOME ?? ''
    if (remotePath.startsWith(this.remoteBase)) {
      const relative = remotePath.slice(this.remoteBase.length).replace(/^\/+/, '')
      return `${home}/${relative}`
    }
    return remotePath
  }
}

/**
 * Normalizes a path for cross-platform compatibility.
 * Handles forward/backward slash differences.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/**
 * Detects if a path is absolute on the current platform.
 */
export function isAbsolutePath(path: string): boolean {
  if (process.platform === 'win32') {
    return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith('\\\\')
  }
  return path.startsWith('/')
}

/**
 * Converts a path to use the current platform's separators.
 */
export function toPlatformPath(path: string): string {
  if (process.platform === 'win32') {
    return path.replace(/\//g, '\\')
  }
  return path.replace(/\\/g, '/')
}

/**
 * Creates the appropriate path converter based on environment.
 * Returns null if no conversion is needed.
 */
export function createPathConverter(options?: {
  wslDistro?: string
  remoteBase?: string
}): PathConverter | null {
  if (options?.wslDistro) {
    return new WindowsToWSLConverter(options.wslDistro)
  }
  if (options?.remoteBase) {
    return new MacOSToLinuxConverter(options.remoteBase)
  }
  return null
}
