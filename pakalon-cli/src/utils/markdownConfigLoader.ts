/**
 * Markdown Config Loader
 *
 * Utilities for parsing markdown configuration files used by plugins.
 */

import { parseFrontmatter } from './frontmatterParser.js'

export function parseAgentToolsFromFrontmatter(tools: unknown): string[] | undefined {
  if (!tools) return undefined
  if (typeof tools === 'string') {
    return tools.split(',').map(t => t.trim()).filter(Boolean)
  }
  if (Array.isArray(tools)) {
    return tools.map(t => String(t).trim()).filter(Boolean)
  }
  return undefined
}

export function parseSlashCommandToolsFromFrontmatter(skills: unknown): string[] | undefined {
  if (!skills) return undefined
  if (typeof skills === 'string') {
    return skills.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (Array.isArray(skills)) {
    return skills.map(s => String(s).trim()).filter(Boolean)
  }
  return undefined
}

export function extractDescriptionFromMarkdown(content: string, fallbackContext: string): string {
  const lines = content.split('\n').filter(line => line.trim())

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    if (trimmed.startsWith('#')) continue
    if (trimmed.startsWith('```')) continue

    const cleaned = trimmed.replace(/^[*_`~]+|[*_`~]+$/g, '')
    if (cleaned.length > 0 && cleaned.length < 200) {
      return cleaned
    }
  }

  return `${fallbackContext} - ${content.slice(0, 100)}...`
}

export function parseArgumentNames(args: unknown): string[] {
  if (!args) return []
  if (typeof args === 'string') {
    return args.split(/[,\s]+/).filter(Boolean)
  }
  if (Array.isArray(args)) {
    return args.map(a => String(a)).filter(Boolean)
  }
  return []
}

export function parseUserSpecifiedModel(model: string): string | undefined {
  const trimmed = model.trim()
  if (trimmed.length === 0) return undefined

  const lower = trimmed.toLowerCase()

  const aliases: Record<string, string> = {
    haiku: 'claude-3-haiku',
    sonnet: 'claude-3-5-sonnet',
    opus: 'claude-3-opus',
    'sonnet-4': 'claude-sonnet-4-20250514',
    '4-sonnet': 'claude-sonnet-4-20250514',
  }

  return aliases[lower] || trimmed
}

interface MarkdownConfig {
  name?: string
  description?: string
  tools?: string[]
  skills?: string[]
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  arguments?: string[]
  argumentHint?: string
  whenToUse?: string
  version?: string
}

export function parseMarkdownConfig(content: string): MarkdownConfig {
  const { frontmatter } = parseFrontmatter(content)
  return {
    name: frontmatter.name as string | undefined,
    description: frontmatter.description as string | undefined,
    tools: frontmatter.tools as string[] | undefined,
    skills: frontmatter.skills as string[] | undefined,
    model: frontmatter.model as string | undefined,
    allowedTools: frontmatter['allowed-tools'] as string[] | undefined,
    disallowedTools: frontmatter.disallowedTools as string[] | undefined,
    arguments: frontmatter.arguments as string[] | undefined,
    argumentHint: frontmatter['argument-hint'] as string | undefined,
    whenToUse: frontmatter.when_to_use as string | undefined,
    version: frontmatter.version as string | undefined,
  }
}