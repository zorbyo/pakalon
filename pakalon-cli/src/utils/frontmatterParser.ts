/**
 * Frontmatter Parser
 *
 * Parses YAML-like frontmatter from markdown files.
 */

interface FrontmatterResult {
  frontmatter: Record<string, unknown>
  content: string
}

export function parseFrontmatter(content: string, filePath?: string): FrontmatterResult {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { frontmatter: {}, content }
  }

  const frontmatterStr = match[1]
  const frontmatter: Record<string, unknown> = {}

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()

    if (key && value) {
      frontmatter[key] = parseFrontmatterValue(value)
    }
  }

  const markdownContent = content.slice(match[0].length)
  return { frontmatter, content: markdownContent }
}

function parseFrontmatterValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === 'undefined') return null
  if (value === '[]' || value === '{}') return JSON.parse(value)

  const num = Number(value)
  if (!isNaN(num) && value !== '') return num

  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value)
    } catch {}
  }

  return value
}

export function parseBooleanFrontmatter(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export function parseShellFrontmatter(value: unknown, commandName?: string): { shell: boolean; command?: string } | undefined {
  if (value === true || value === 'true') return { shell: true }
  if (value === 'bash') return { shell: true, command: 'bash' }
  if (value === 'sh') return { shell: true, command: 'sh' }
  if (value === 'pwsh' || value === 'powershell') return { shell: true, command: 'pwsh' }
  if (typeof value === 'string') return { shell: true, command: value }
  return undefined
}

export function coerceDescriptionToString(value: unknown, context?: string): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join('\n')
  if (value === null || value === undefined) return null
  return String(value)
}

export type FrontmatterData = Record<string, unknown>