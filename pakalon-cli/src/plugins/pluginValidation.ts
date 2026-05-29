/**
 * Plugin Validation
 *
 * Handles plugin manifest validation and plugin creation from paths.
 * Ensures plugins conform to expected structure and schema.
 */

import path from 'path'
import { pathExists } from '../utils/file.js'
import { logForDebugging } from '../utils/debug.js'
import {
  type PluginManifest,
  type Plugin,
  type PluginError,
  type CommandMetadata,
  type DependencyRef,
} from './types.js'

function validatePluginName(name: string): boolean {
  if (!name || name.length === 0) return false
  if (name.includes(' ')) return false
  if (!/^[a-zA-Z0-9][-a-zA-Z0-9._]*$/.test(name)) return false
  return true
}

function validateVersion(version: string): boolean {
  if (!version) return true
  return /^(\d+\.)?(\d+\.)?(\d+)$/.test(version) || /^[a-f0-9]{40}$/.test(version)
}

function validateDependencyRef(dep: unknown): dep is DependencyRef {
  if (typeof dep !== 'object' || dep === null) return false
  const d = dep as DependencyRef
  return typeof d.name === 'string' && d.name.length > 0
}

function validateCommandMetadata(metadata: unknown): metadata is CommandMetadata {
  if (typeof metadata !== 'object' || metadata === null) return false
  const m = metadata as Record<string, unknown>

  if (m.source !== undefined && typeof m.source !== 'string') return false
  if (m.content !== undefined && typeof m.content !== 'string') return false
  if (m.description !== undefined && typeof m.description !== 'string') return false
  if (m.argumentHint !== undefined && typeof m.argumentHint !== 'string') return false
  if (m.model !== undefined && typeof m.model !== 'string') return false
  if (m.allowedTools !== undefined && !Array.isArray(m.allowedTools)) return false

  return true
}

export function validatePluginManifest(manifest: unknown): PluginManifest | null {
  if (typeof manifest !== 'object' || manifest === null) {
    logForDebugging('Plugin manifest must be an object')
    return null
  }

  const m = manifest as Record<string, unknown>

  if (typeof m.name !== 'string' || !validatePluginName(m.name)) {
    logForDebugging('Plugin manifest has invalid or missing name')
    return null
  }

  const validated: PluginManifest = {
    name: m.name,
  }

  if (m.version !== undefined) {
    if (typeof m.version !== 'string' || !validateVersion(m.version)) {
      logForDebugging(`Plugin manifest has invalid version: ${m.version}`)
    } else {
      validated.version = m.version
    }
  }

  if (m.description !== undefined && typeof m.description === 'string') {
    validated.description = m.description
  }

  if (m.author !== undefined) {
    if (typeof m.author === 'string') {
      validated.author = { name: m.author }
    } else if (typeof m.author === 'object' && m.author !== null) {
      const author = m.author as Record<string, unknown>
      validated.author = {
        name: typeof author.name === 'string' ? author.name : m.name,
        email: typeof author.email === 'string' ? author.email : undefined,
        url: typeof author.url === 'string' ? author.url : undefined,
      }
    }
  }

  if (m.homepage !== undefined && typeof m.homepage === 'string') {
    validated.homepage = m.homepage
  }

  if (m.repository !== undefined && typeof m.repository === 'string') {
    validated.repository = m.repository
  }

  if (m.license !== undefined && typeof m.license === 'string') {
    validated.license = m.license
  }

  if (Array.isArray(m.keywords)) {
    validated.keywords = m.keywords.filter(k => typeof k === 'string')
  }

  if (Array.isArray(m.dependencies)) {
    const validDeps = m.dependencies.filter(validateDependencyRef)
    if (validDeps.length > 0) {
      validated.dependencies = validDeps
    }
  }

  if (m.hooks !== undefined) {
    validated.hooks = m.hooks as PluginManifest['hooks']
  }

  if (m.commands !== undefined) {
    if (typeof m.commands === 'string') {
      validated.commands = m.commands
    } else if (Array.isArray(m.commands)) {
      validated.commands = m.commands.filter(c => typeof c === 'string')
    } else if (typeof m.commands === 'object' && m.commands !== null) {
      const commandsObj = m.commands as Record<string, unknown>
      const validCommands: Record<string, CommandMetadata> = {}

      for (const [key, value] of Object.entries(commandsObj)) {
        if (validateCommandMetadata(value)) {
          validCommands[key] = value
        }
      }

      if (Object.keys(validCommands).length > 0) {
        validated.commands = validCommands
      }
    }
  }

  if (m.agents !== undefined) {
    if (typeof m.agents === 'string') {
      validated.agents = m.agents
    } else if (Array.isArray(m.agents)) {
      validated.agents = m.agents.filter(a => typeof a === 'string')
    }
  }

  if (m.skills !== undefined) {
    if (typeof m.skills === 'string') {
      validated.skills = m.skills
    } else if (Array.isArray(m.skills)) {
      validated.skills = m.skills.filter(s => typeof s === 'string')
    }
  }

  if (m.outputStyles !== undefined) {
    if (typeof m.outputStyles === 'string') {
      validated.outputStyles = m.outputStyles
    } else if (Array.isArray(m.outputStyles)) {
      validated.outputStyles = m.outputStyles.filter(s => typeof s === 'string')
    }
  }

  if (m.mcpServers !== undefined) {
    validated.mcpServers = m.mcpServers as PluginManifest['mcpServers']
  }

  if (typeof m.userConfig === 'object' && m.userConfig !== null) {
    validated.userConfig = m.userConfig as PluginManifest['userConfig']
  }

  if (typeof m.settings === 'object' && m.settings !== null) {
    validated.settings = m.settings as PluginManifest['settings']
  }

  return validated
}

export async function validatePluginPath(pluginPath: string): Promise<{
  valid: boolean
  errors: string[]
}> {
  const errors: string[] = []

  if (!(await pathExists(pluginPath))) {
    errors.push(`Plugin path does not exist: ${pluginPath}`)
    return { valid: false, errors }
  }

  const manifestPath = path.join(pluginPath, 'pakalon.json')

  if (await pathExists(manifestPath)) {
    try {
      const content = await require('fs').readFileSync(manifestPath, 'utf-8')
      const parsed = JSON.parse(content)
      const validated = validatePluginManifest(parsed)

      if (!validated) {
        errors.push('Invalid plugin manifest')
      }
    } catch (error) {
      errors.push(`Failed to parse manifest: ${error}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function createMinimalManifest(name: string, source: string): PluginManifest {
  return {
    name: name.replace(/[^a-zA-Z0-9-_]/g, '-'),
    description: `Plugin from ${source}`,
  }
}

export function mergePluginManifests(base: PluginManifest, override: Partial<PluginManifest>): PluginManifest {
  return {
    ...base,
    ...override,
    author: override.author || base.author,
    dependencies: [...(base.dependencies || []), ...(override.dependencies || [])],
    keywords: [...(base.keywords || []), ...(override.keywords || [])],
  }
}

export class PluginValidator {
  private strict: boolean

  constructor(strict: boolean = false) {
    this.strict = strict
  }

  validate(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (typeof manifest !== 'object' || manifest === null) {
      return { valid: false, errors: ['Manifest must be an object'] }
    }

    const m = manifest as Record<string, unknown>

    if (typeof m.name !== 'string') {
      errors.push('Plugin name is required and must be a string')
    } else if (!validatePluginName(m.name)) {
      errors.push('Plugin name contains invalid characters')
    }

    if (m.version !== undefined && (typeof m.version !== 'string' || !validateVersion(m.version))) {
      errors.push('Version must be a valid semver or git SHA')
    }

    if (this.strict) {
      if (m.dependencies !== undefined && !Array.isArray(m.dependencies)) {
        errors.push('Dependencies must be an array')
      }

      if (m.commands !== undefined && typeof m.commands !== 'string' && !Array.isArray(m.commands) && typeof m.commands !== 'object') {
        errors.push('Commands must be a string, array, or object')
      }
    }

    return { valid: errors.length === 0, errors }
  }
}

export const defaultPluginValidator = new PluginValidator()