/**
 * Plugin System Type Definitions
 *
 * Based on claude_source_code/utils/plugins patterns for pakalon-cli plugin system.
 * Supports: custom agents, tools, commands, and hooks.
 */

import type { Command } from '../commands.js'
import type { HooksSettings } from '../utils/settings/types.js'

export type PluginStatus = 'unloaded' | 'loading' | 'loaded' | 'error' | 'disabled'

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: PluginAuthor
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  dependencies?: DependencyRef[]
  hooks?: string | HooksSettings | Array<string | HooksSettings>
  commands?: string | string[] | Record<string, CommandMetadata>
  agents?: string | string[]
  skills?: string | string[]
  outputStyles?: string | string[]
  mcpServers?: string | Record<string, unknown> | unknown[]
  userConfig?: Record<string, UserConfigOption>
  settings?: Record<string, unknown>
}

export interface PluginAuthor {
  name: string
  email?: string
  url?: string
}

export interface UserConfigOption {
  type: 'string' | 'number' | 'boolean' | 'directory' | 'file'
  title: string
  description: string
  required?: boolean
  default?: string | number | boolean | string[]
  multiple?: boolean
  sensitive?: boolean
  min?: number
  max?: number
}

export interface CommandMetadata {
  source?: string
  content?: string
  description?: string
  argumentHint?: string
  model?: string
  allowedTools?: string[]
}

export interface DependencyRef {
  name: string
  marketplace?: string
}

export interface Plugin {
  id: string
  manifest: PluginManifest
  path: string
  source: string
  repository: string
  status: PluginStatus
  instance?: unknown
  loadedAt?: string
  error?: string
  enabled?: boolean
  isBuiltin?: boolean
  sha?: string
  commandsPath?: string
  commandsPaths?: string[]
  commandsMetadata?: Record<string, CommandMetadata>
  agentsPath?: string
  agentsPaths?: string[]
  skillsPath?: string
  skillsPaths?: string[]
  outputStylesPath?: string
  outputStylesPaths?: string[]
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, unknown>
  settings?: Record<string, unknown>
}

export interface PluginHook {
  name: string
  handler: (context: unknown) => Promise<unknown> | unknown
  priority?: number
  pluginId?: string
}

export interface PluginTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (input: unknown) => Promise<unknown>
  pluginId?: string
}

export interface PluginCommand {
  name: string
  description?: string
  handler: (args: unknown) => Promise<unknown>
  pluginId?: string
  allowedTools?: string[]
  argumentHint?: string
  model?: string
  effort?: number
}

export type PluginComponent = 'commands' | 'agents' | 'skills' | 'hooks' | 'output-styles'

export type PluginError =
  | { type: 'path-not-found'; source: string; plugin?: string; path: string; component: PluginComponent }
  | { type: 'git-auth-failed'; source: string; plugin?: string; gitUrl: string; authType: 'ssh' | 'https' }
  | { type: 'git-timeout'; source: string; plugin?: string; gitUrl: string; operation: 'clone' | 'pull' }
  | { type: 'network-error'; source: string; plugin?: string; url: string; details?: string }
  | { type: 'manifest-parse-error'; source: string; plugin?: string; manifestPath: string; parseError: string }
  | { type: 'manifest-validation-error'; source: string; plugin?: string; manifestPath: string; validationErrors: string[] }
  | { type: 'plugin-not-found'; source: string; pluginId: string; marketplace: string }
  | { type: 'marketplace-not-found'; source: string; marketplace: string; availableMarketplaces: string[] }
  | { type: 'marketplace-load-failed'; source: string; marketplace: string; reason: string }
  | { type: 'hook-load-failed'; source: string; plugin: string; hookPath: string; reason: string }
  | { type: 'plugin-cache-miss'; source: string; plugin: string; installPath: string }
  | { type: 'generic-error'; source: string; plugin?: string; error: string }

export type PluginLoadResult = {
  enabled: Plugin[]
  disabled: Plugin[]
  errors: PluginError[]
}

export type AgentDefinition = {
  agentType: string
  whenToUse?: string
  tools?: string[]
  skills?: string[]
  disallowedTools?: string[]
  getSystemPrompt: () => string | Promise<string>
  source: 'plugin'
  color?: string
  model?: string
  filename: string
  plugin: string
  background?: boolean
  memory?: AgentMemoryScope
  isolation?: 'worktree' | 'remote'
  effort?: number
  maxTurns?: number
}

export type AgentMemoryScope = 'user' | 'project' | 'local'

export interface PluginSource {
  source: 'npm' | 'pip' | 'github' | 'url' | 'git-subdir'
  package?: string
  url?: string
  repo?: string
  path?: string
  ref?: string
  sha?: string
  version?: string
  registry?: string
}

export function getPluginErrorMessage(error: PluginError): string {
  switch (error.type) {
    case 'generic-error':
      return error.error
    case 'path-not-found':
      return `Path not found: ${error.path} (${error.component})`
    case 'git-auth-failed':
      return `Git authentication failed (${error.authType}): ${error.gitUrl}`
    case 'git-timeout':
      return `Git ${error.operation} timeout: ${error.gitUrl}`
    case 'network-error':
      return `Network error: ${error.url}${error.details ? ` - ${error.details}` : ''}`
    case 'manifest-parse-error':
      return `Manifest parse error: ${error.parseError}`
    case 'manifest-validation-error':
      return `Manifest validation failed: ${error.validationErrors.join(', ')}`
    case 'plugin-not-found':
      return `Plugin ${error.pluginId} not found in marketplace ${error.marketplace}`
    case 'marketplace-not-found':
      return `Marketplace ${error.marketplace} not found`
    case 'marketplace-load-failed':
      return `Marketplace ${error.marketplace} failed to load: ${error.reason}`
    case 'hook-load-failed':
      return `Hook load failed: ${error.reason}`
    case 'plugin-cache-miss':
      return `Plugin "${error.plugin}" not cached at ${error.installPath}`
  }
}
