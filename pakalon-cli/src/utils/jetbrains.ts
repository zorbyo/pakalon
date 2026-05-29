/**
 * JetBrains IDE Support — utilities for detecting and interacting with JetBrains IDEs.
 *
 * Supports: IntelliJ IDEA, WebStorm, PyCharm, GoLand, CLion, RubyMine, PhpStorm, DataGrip, Rider, Android Studio
 */

import { execFileNoThrow } from './execFileNoThrow.js'
import { isWindows, isMacOS, isLinux } from './envUtils.js'

export type JetBrainsProduct =
  | 'idea'
  | 'webstorm'
  | 'pycharm'
  | 'goland'
  | 'clion'
  | 'rubymine'
  | 'phpstorm'
  | 'datagrip'
  | 'rider'
  | 'androidstudio'
  | 'fleet'

export interface JetBrainsInfo {
  product: JetBrainsProduct
  displayName: string
  executable: string
  pluginId: string
  pluginUrl: string
  minVersion: string
}

const JETBRAINS_PRODUCTS: Record<JetBrainsProduct, JetBrainsInfo> = {
  idea: {
    product: 'idea',
    displayName: 'IntelliJ IDEA',
    executable: 'idea',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  webstorm: {
    product: 'webstorm',
    displayName: 'WebStorm',
    executable: 'webstorm',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  pycharm: {
    product: 'pycharm',
    displayName: 'PyCharm',
    executable: 'pycharm',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  goland: {
    product: 'goland',
    displayName: 'GoLand',
    executable: 'goland',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  clion: {
    product: 'clion',
    displayName: 'CLion',
    executable: 'clion',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  rubymine: {
    product: 'rubymine',
    displayName: 'RubyMine',
    executable: 'rubymine',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  phpstorm: {
    product: 'phpstorm',
    displayName: 'PhpStorm',
    executable: 'phpstorm',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  datagrip: {
    product: 'datagrip',
    displayName: 'DataGrip',
    executable: 'datagrip',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  rider: {
    product: 'rider',
    displayName: 'Rider',
    executable: 'rider',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  androidstudio: {
    product: 'androidstudio',
    displayName: 'Android Studio',
    executable: 'studio',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '2023.1',
  },
  fleet: {
    product: 'fleet',
    displayName: 'Fleet',
    executable: 'fleet',
    pluginId: 'com.anthropic.claude-code',
    pluginUrl: 'https://plugins.jetbrains.com/plugin/26001-claude-code',
    minVersion: '1.0',
  },
}

/**
 * Returns all JetBrains products with their metadata.
 */
export function getJetBrainsProducts(): JetBrainsInfo[] {
  return Object.values(JETBRAINS_PRODUCTS)
}

/**
 * Get product info by product key.
 */
export function getJetBrainsProduct(product: JetBrainsProduct): JetBrainsInfo {
  return JETBRAINS_PRODUCTS[product]
}

/**
 * Check if a JetBrains IDE CLI tool is available on PATH.
 */
export async function isJetBrainsCliAvailable(
  executable: string,
): Promise<boolean> {
  try {
    const { code } = await execFileNoThrow(
      isWindows() ? 'where' : 'which',
      [executable],
    )
    return code === 0
  } catch {
    return false
  }
}

/**
 * Detect which JetBrains IDEs are available on the system.
 */
export async function detectAvailableJetBrainsIDEs(): Promise<JetBrainsInfo[]> {
  const available: JetBrainsInfo[] = []

  for (const product of Object.values(JETBRAINS_PRODUCTS)) {
    if (await isJetBrainsCliAvailable(product.executable)) {
      available.push(product)
    }
  }

  return available
}

/**
 * Check if the current terminal is running inside a JetBrains IDE.
 * Detects via environment variables set by JetBrains terminal emulator.
 */
export function isRunningInJetBrainsTerminal(): boolean {
  return !!(
    process.env.JETBRAINS_IDE ||
    process.env.IDEA_INITIAL_DIRECTORY ||
    process.env.WEBSTORM_INITIAL_DIRECTORY ||
    process.env.PYCHARM_INITIAL_DIRECTORY ||
    process.env.$IDE_WORK_DIR
  )
}

/**
 * Check if JetBrains terminal integration is supported.
 * Requires JetBrains IDE with terminal plugin and Claude Code plugin installed.
 */
export function isSupportedJetBrainsTerminal(): boolean {
  return isRunningInJetBrainsTerminal() && !!process.env.IDE_TERMINAL_PROJECT_DIR
}

/**
 * Get the project directory from JetBrains terminal environment.
 */
export function getJetBrainsProjectDir(): string | null {
  return process.env.IDE_TERMINAL_PROJECT_DIR ??
    process.env.IDEA_INITIAL_DIRECTORY ??
    process.env.WEBSTORM_INITIAL_DIRECTORY ??
    process.env.PYCHARM_INITIAL_DIRECTORY ??
    null
}

/**
 * Get the JetBrains IDE name from environment.
 */
export function getJetBrainsIdeName(): string | null {
  const ide = process.env.JETBRAINS_IDE
  if (!ide) return null

  const nameMap: Record<string, string> = {
    'IntelliJ IDEA': 'IntelliJ IDEA',
    WebStorm: 'WebStorm',
    PyCharm: 'PyCharm',
    GoLand: 'GoLand',
    CLion: 'CLion',
    RubyMine: 'RubyMine',
    PhpStorm: 'PhpStorm',
    DataGrip: 'DataGrip',
    Rider: 'Rider',
    'Android Studio': 'Android Studio',
    Fleet: 'Fleet',
  }

  return nameMap[ide] ?? ide
}

/**
 * Check if a given IDE name is a JetBrains product.
 */
export function isJetBrainsIde(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.includes('intellij') ||
    lower.includes('webstorm') ||
    lower.includes('pycharm') ||
    lower.includes('goland') ||
    lower.includes('clion') ||
    lower.includes('rubymine') ||
    lower.includes('phpstorm') ||
    lower.includes('datagrip') ||
    lower.includes('rider') ||
    lower.includes('android studio') ||
    lower.includes('fleet') ||
    lower.includes('jetbrains')
  )
}

/**
 * Open a project in a JetBrains IDE using its CLI tool.
 */
export async function openInJetBrainsIDE(
  product: JetBrainsProduct,
  projectPath: string,
): Promise<{ success: boolean; error?: string }> {
  const info = JETBRAINS_PRODUCTS[product]
  if (!info) {
    return { success: false, error: `Unknown JetBrains product: ${product}` }
  }

  try {
    const { code, stderr } = await execFileNoThrow(info.executable, [
      projectPath,
    ])

    if (code === 0) {
      return { success: true }
    }

    return {
      success: false,
      error: stderr || `Failed to open in ${info.displayName}`,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : `Failed to launch ${info.displayName}`,
    }
  }
}

/**
 * Get the JetBrains plugin installation URL.
 */
export function getJetBrainsPluginUrl(): string {
  return 'https://plugins.jetbrains.com/plugin/26001-claude-code'
}

/**
 * Check if the Claude Code plugin is likely installed in a JetBrains IDE.
 * This checks for the plugin configuration directory.
 */
export async function isJetBrainsPluginInstalled(
  product?: JetBrainsProduct,
): Promise<boolean> {
  const homeDir =
    process.env[isWindows() ? 'USERPROFILE' : 'HOME'] ?? process.cwd()

  const pluginDirs = [
    '.local/share/JetBrains',
    'AppData/Roaming/JetBrains',
    'Library/Application Support/JetBrains',
  ]

  for (const dir of pluginDirs) {
    const basePath = isWindows()
      ? `${process.env.USERPROFILE}\\${dir}`
      : `${homeDir}/${dir}`

    try {
      const { code } = await execFileNoThrow(
        isWindows() ? 'cmd' : 'ls',
        isWindows() ? ['/c', 'dir', basePath] : [basePath],
      )
      if (code === 0) {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}
