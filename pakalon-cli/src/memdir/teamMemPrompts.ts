/**
 * Team Memory Prompts
 *
 * Generates and manages system prompts for team memory synchronization,
 * including context injection and team-specific instructions.
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import logger from '../../utils/logger.js'
import { getTeamMemPaths } from './teamMemPaths.js'
import { getMemoryAgeInfo } from './memoryAge.js'

export interface TeamMemoryPromptContext {
  projectRoot: string
  teamName?: string
  memberName?: string
  role?: string
  includeRecentChanges?: boolean
  maxContextFiles?: number
}

export interface TeamMemoryPromptResult {
  systemPrompt: string
  contextFiles: TeamMemoryContextFile[]
  warnings: string[]
}

export interface TeamMemoryContextFile {
  path: string
  content: string
  age: string
  relevance: number
}

const TEAM_MEMORY_SYSTEM_PROMPT = `You are working in a team environment with shared memory files.
Team memory files contain shared knowledge, conventions, and decisions.
Always check team memory files before making changes to ensure consistency.

When working with team memory:
1. Read existing team memory before making changes
2. Update memory files when you discover new patterns or decisions
3. Respect team conventions documented in memory files
4. Note any conflicts between local and team memory`

export async function buildTeamMemoryPrompt(
  context: TeamMemoryPromptContext,
): Promise<TeamMemoryPromptResult> {
  const {
    projectRoot,
    teamName = 'team',
    memberName,
    role,
    includeRecentChanges = true,
    maxContextFiles = 10,
  } = context

  const warnings: string[] = []
  const contextFiles: TeamMemoryContextFile[] = []

  const teamPaths = getTeamMemPaths(projectRoot)
  let allContent = ''

  for (const teamPath of teamPaths) {
    try {
      const files = await readMemoryDirectory(teamPath)

      for (const file of files) {
        const ageInfo = getMemoryAgeInfo(file.mtimeMs)
        const relevance = calculateRelevance(file.name, ageInfo)

        contextFiles.push({
          path: file.path,
          content: file.content,
          age: ageInfo.label,
          relevance,
        })
      }
    } catch (error) {
      logger.debug('[team-mem-prompts] Failed to read team path', {
        path: teamPath,
        error: String(error),
      })
    }
  }

  contextFiles.sort((a, b) => b.relevance - a.relevance)
  const limitedFiles = contextFiles.slice(0, maxContextFiles)

  if (limitedFiles.length === 0) {
    warnings.push('No team memory files found')
  }

  const staleFiles = limitedFiles.filter(f => {
    const ageInfo = getMemoryAgeInfo(0)
    return ageInfo.isStale
  })

  if (staleFiles.length > 0) {
    warnings.push(`${staleFiles.length} team memory file(s) may be outdated`)
  }

  const contextBlock = limitedFiles
    .map(f => {
      const relativePath = path.relative(projectRoot, f.path)
      return `<team-memory-file path="${relativePath}" age="${f.age}">\n${f.content}\n</team-memory-file>`
    })
    .join('\n\n')

  const memberInfo = memberName
    ? `\nTeam member: ${memberName}${role ? ` (${role})` : ''}`
    : ''

  const systemPrompt = `${TEAM_MEMORY_SYSTEM_PROMPT}

Team: ${teamName}${memberInfo}

${contextBlock ? `## Team Memory Context\n\n${contextBlock}` : ''}

${includeRecentChanges ? generateRecentChangesSection(limitedFiles) : ''}`

  return {
    systemPrompt,
    contextFiles: limitedFiles,
    warnings,
  }
}

export function buildTeamMemorySyncPrompt(
  projectRoot: string,
  options: {
    localChanges?: string[]
    teamChanges?: string[]
    conflicts?: Array<{ file: string; local: string; team: string }>
  } = {},
): string {
  const { localChanges = [], teamChanges = [], conflicts = [] } = options

  let prompt = `# Team Memory Sync

## Local Changes
${localChanges.length > 0 ? localChanges.map(c => `- ${c}`).join('\n') : 'No local changes'}

## Team Changes
${teamChanges.length > 0 ? teamChanges.map(c => `- ${c}`).join('\n') : 'No team changes'}

${conflicts.length > 0 ? `## Conflicts\n\n${conflicts.map(c => `- **${c.file}**: Local vs Team difference`).join('\n')}` : 'No conflicts detected'}

Please review and resolve any conflicts before continuing.`

  return prompt
}

export function buildTeamMemorySummaryPrompt(
  files: Array<{ path: string; content: string }>,
  projectRoot: string,
): string {
  const summaries = files.map(f => {
    const relativePath = path.relative(projectRoot, f.path)
    const firstLines = f.content.split('\n').slice(0, 5).join('\n')
    return `### ${relativePath}\n\n${firstLines}${f.content.split('\n').length > 5 ? '\n...' : ''}`
  })

  return `# Team Memory Summary\n\n${summaries.join('\n\n')}`
}

async function readMemoryDirectory(
  dirPath: string,
): Promise<Array<{ path: string; name: string; content: string; mtimeMs: number }>> {
  const files: Array<{ path: string; name: string; content: string; mtimeMs: number }> = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(md|markdown|txt)$/i.test(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)
      const stats = await fs.stat(fullPath)
      const content = await fs.readFile(fullPath, 'utf-8')

      files.push({
        path: fullPath,
        name: entry.name,
        content,
        mtimeMs: stats.mtimeMs,
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error('[team-mem-prompts] Failed to read directory', {
        dir: dirPath,
        error: String(error),
      })
    }
  }

  return files
}

function calculateRelevance(
  fileName: string,
  ageInfo: ReturnType<typeof getMemoryAgeInfo>,
): number {
  let score = 50

  const nameLower = fileName.toLowerCase()

  if (nameLower.includes('claude') || nameLower.includes('pakalon')) {
    score += 30
  }

  if (nameLower.includes('memory')) {
    score += 20
  }

  if (nameLower.includes('convention') || nameLower.includes('style')) {
    score += 15
  }

  if (nameLower.includes('architecture') || nameLower.includes('decision')) {
    score += 10
  }

  if (!ageInfo.isStale) {
    score += 10
  }

  if (ageInfo.category === 'fresh' || ageInfo.category === 'recent') {
    score += 15
  }

  return Math.min(score, 100)
}

function generateRecentChangesSection(
  files: TeamMemoryContextFile[],
): string {
  const recentFiles = files
    .filter(f => !f.age.includes('mo') && !f.age.includes('y'))
    .slice(0, 5)

  if (recentFiles.length === 0) {
    return ''
  }

  const list = recentFiles
    .map(f => {
      const relativePath = path.relative(process.cwd(), f.path)
      return `- ${relativePath} (${f.age})`
    })
    .join('\n')

  return `## Recent Team Memory Updates\n\n${list}`
}
