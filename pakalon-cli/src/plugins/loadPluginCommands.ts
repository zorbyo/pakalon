/**
 * Plugin Command Loader
 *
 * Loads slash commands from plugin directories and registers them into the
 * live slash-command registry used by help/autocomplete.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'
import type { CommandMetadata, PluginManifest } from './types.js'
import { registerSlashCommand, unregisterSlashCommand, getSlashCommand } from '../commands/slash-registry.js'

export type PluginCommand = {
  name: string
  description: string
  content?: string
  usage?: string
  argumentHint?: string
  model?: string
  allowedTools?: string[]
  aliases?: string[]
  hidden?: boolean
  pluginName: string
  pluginId: string
  sourcePath: string
}

type LoadedCommandRecord = {
  command: PluginCommand
  registeredName: string
}

const loadedCommandsByPlugin = new Map<string, LoadedCommandRecord[]>()

function normalizeName(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase()
}

function firstHeading(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function deriveDescription(commandName: string, metadata?: CommandMetadata, content?: string): string | undefined {
  if (metadata?.description?.trim()) return metadata.description.trim()
  if (content) {
    const heading = firstHeading(content)
    if (heading) return heading
    const firstLine = content.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    if (firstLine) return firstLine.slice(0, 120)
  }
  return `${commandName} plugin command`
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function loadCommandFromFile(
  filePath: string,
  pluginName: string,
  pluginId: string,
  metadata?: CommandMetadata,
): Promise<PluginCommand | null> {
  const raw = await readTextIfExists(filePath)
  if (!raw) return null

  const { frontmatter, content } = parseFrontmatter(raw, filePath)
  const name = normalizeName(
    String(frontmatter.name ?? metadata?.source ?? path.basename(filePath, path.extname(filePath))),
  )
  if (!name) return null

  const description = deriveDescription(name, metadata, String(frontmatter.description ?? content ?? metadata?.content ?? ''))
  const allowedTools = Array.isArray(frontmatter.allowedTools)
    ? frontmatter.allowedTools.filter((tool): tool is string => typeof tool === 'string')
    : metadata?.allowedTools

  return {
    name,
    description: String(description ?? `${name} command`),
    content: metadata?.content ?? (content.trim() || undefined),
    usage: typeof frontmatter.usage === 'string' ? frontmatter.usage : undefined,
    argumentHint: metadata?.argumentHint,
    model: metadata?.model,
    allowedTools,
    aliases: Array.isArray(frontmatter.aliases) ? frontmatter.aliases.filter((alias): alias is string => typeof alias === 'string').map(normalizeName) : undefined,
    hidden: frontmatter.hidden === true,
    pluginName,
    pluginId,
    sourcePath: filePath,
  }
}

function validateCommand(command: PluginCommand, seen: Set<string>): string | null {
  if (!command.name) return 'missing command name'
  if (!command.description && !command.content) return `command ${command.name} is missing description/content`

  const normalized = normalizeName(command.name)
  if (seen.has(normalized)) return `duplicate command name in plugin: ${command.name}`
  if (getSlashCommand(normalized)) return `command name already exists: ${command.name}`

  for (const alias of command.aliases ?? []) {
    const normalizedAlias = normalizeName(alias)
    if (!normalizedAlias) return `invalid alias on ${command.name}`
    if (seen.has(normalizedAlias)) return `duplicate alias in plugin: ${alias}`
    if (getSlashCommand(normalizedAlias)) return `alias already exists: ${alias}`
  }

  return null
}

async function collectMarkdownCommands(
  commandsDir: string,
  pluginName: string,
  pluginId: string,
): Promise<PluginCommand[]> {
  const commands: PluginCommand[] = []
  await walkPluginMarkdown(commandsDir, async (fullPath) => {
    const command = await loadCommandFromFile(fullPath, pluginName, pluginId)
    if (command) commands.push(command)
  }, { logLabel: 'commands' })
  return commands
}

async function collectManifestMappedCommands(
  pluginDir: string,
  pluginName: string,
  pluginId: string,
  manifestCommands: Record<string, CommandMetadata>,
): Promise<PluginCommand[]> {
  const commands: PluginCommand[] = []

  for (const [name, metadata] of Object.entries(manifestCommands)) {
    const normalizedName = normalizeName(name)
    const sourceCandidates = [
      metadata.source,
      path.join(pluginDir, 'commands', `${normalizedName}.md`),
      path.join(pluginDir, 'commands', `${name}.md`),
      path.join(pluginDir, `${normalizedName}.md`),
    ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)

    let filePath: string | undefined
    let content: string | undefined

    for (const candidate of sourceCandidates) {
      const resolved = path.isAbsolute(candidate) ? candidate : path.join(pluginDir, candidate)
      content = await readTextIfExists(resolved)
      if (content !== null) {
        filePath = resolved
        break
      }
    }

    commands.push({
      name: normalizedName,
      description: deriveDescription(normalizedName, metadata, content ?? metadata.content),
      content: metadata.content ?? content ?? undefined,
      usage: metadata.argumentHint,
      argumentHint: metadata.argumentHint,
      model: metadata.model,
      allowedTools: metadata.allowedTools,
      pluginName,
      pluginId,
      sourcePath: filePath ?? path.join(pluginDir, 'commands', `${normalizedName}.md`),
    })
  }

  return commands
}

export async function loadPluginCommands(pluginDir: string, pluginManifest: PluginManifest): Promise<PluginCommand[]> {
  const pluginName = pluginManifest.name
  const pluginId = pluginManifest.version ? `${pluginName}@${pluginManifest.version}` : pluginName
  const collected: PluginCommand[] = []

  const commandsField = pluginManifest.commands
  if (typeof commandsField === 'string') {
    const resolved = path.isAbsolute(commandsField) ? commandsField : path.join(pluginDir, commandsField)
    const stats = await fs.stat(resolved).catch(() => null)
    if (stats?.isDirectory()) {
      collected.push(...await collectMarkdownCommands(resolved, pluginName, pluginId))
    } else {
      const command = await loadCommandFromFile(resolved, pluginName, pluginId)
      if (command) collected.push(command)
    }
  } else if (Array.isArray(commandsField)) {
    for (const entry of commandsField) {
      const resolved = path.isAbsolute(entry) ? entry : path.join(pluginDir, entry)
      const stats = await fs.stat(resolved).catch(() => null)
      if (stats?.isDirectory()) {
        collected.push(...await collectMarkdownCommands(resolved, pluginName, pluginId))
      } else {
        const command = await loadCommandFromFile(resolved, pluginName, pluginId)
        if (command) collected.push(command)
      }
    }
  } else if (commandsField && typeof commandsField === 'object') {
    collected.push(...await collectManifestMappedCommands(pluginDir, pluginName, pluginId, commandsField))
  } else {
    const defaultCommandsDir = path.join(pluginDir, 'commands')
    const stats = await fs.stat(defaultCommandsDir).catch(() => null)
    if (stats?.isDirectory()) {
      collected.push(...await collectMarkdownCommands(defaultCommandsDir, pluginName, pluginId))
    }
  }

  const validCommands: PluginCommand[] = []
  const seen = new Set<string>()

  for (const command of collected) {
    const validationError = validateCommand(command, seen)
    if (validationError) {
      console.warn(`[plugins] skipping command from ${pluginName}: ${validationError}`)
      continue
    }

    seen.add(normalizeName(command.name))
    for (const alias of command.aliases ?? []) {
      seen.add(normalizeName(alias))
    }
    validCommands.push(command)
  }

  return validCommands
}

export function registerPluginCommands(commands: PluginCommand[]): void {
  for (const command of commands) {
    const normalized = normalizeName(command.name)
    registerSlashCommand({
      name: normalized,
      description: command.description,
      usage: command.usage,
      aliases: command.aliases,
      hidden: command.hidden,
      pluginId: command.pluginId,
      category: 'plugins',
    })
  }

  for (const command of commands) {
    const list = loadedCommandsByPlugin.get(command.pluginName) ?? []
    list.push({ command, registeredName: normalizeName(command.name) })
    loadedCommandsByPlugin.set(command.pluginName, list)
  }
}

export function unregisterPluginCommands(pluginName: string): void {
  const records = loadedCommandsByPlugin.get(pluginName)
  if (!records) return

  for (const { command, registeredName } of records) {
    unregisterSlashCommand(registeredName)
    for (const alias of command.aliases ?? []) {
      unregisterSlashCommand(alias)
    }
  }

  loadedCommandsByPlugin.delete(pluginName)
}
