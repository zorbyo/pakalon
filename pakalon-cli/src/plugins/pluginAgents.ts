/**
 * Plugin Agents Module
 *
 * Handles loading and management of custom AI agents provided by plugins.
 * Agents are defined in markdown files with frontmatter configuration.
 *
 * Agent files support the following frontmatter fields:
 * - name: Agent display name (defaults to filename)
 * - description: When to use this agent
 * - tools: List of allowed tools
 * - skills: List of allowed skills
 * - model: Specific model to use
 * - background: Run in background mode
 * - memory: Memory scope (user, project, local)
 * - isolation: Isolation mode (worktree)
 * - effort: Effort level or integer
 * - maxTurns: Maximum conversation turns
 */

import path from 'path'
import memoize from 'lodash-es/memoize.js'
import { basename } from 'path'
import {
  type AgentDefinition,
  type AgentMemoryScope,
  type Plugin,
  getPluginErrorMessage,
} from './types.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { parseAgentToolsFromFrontmatter, parseSlashCommandToolsFromFrontmatter } from '../utils/markdownConfigLoader.js'
import { getFsImplementation, isDuplicatePath } from '../utils/fsOperations.js'
import { logForDebugging } from '../utils/debug.js'
import { EFFORT_LEVELS, parseEffortValue } from '../utils/effort.js'
import { walkPluginMarkdown } from './walkPluginMarkdown.js'
import { loadAllPluginsCacheOnly } from './loadPlugins.js'

const VALID_MEMORY_SCOPES: AgentMemoryScope[] = ['user', 'project', 'local']

async function loadAgentsFromDirectory(
  agentsPath: string,
  pluginName: string,
  sourceName: string,
  pluginPath: string,
  loadedPaths: Set<string>,
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = []

  await walkPluginMarkdown(
    agentsPath,
    async (fullPath, namespace) => {
      const agent = await loadAgentFromFile(
        fullPath,
        pluginName,
        namespace,
        sourceName,
        pluginPath,
        loadedPaths,
      )
      if (agent) agents.push(agent)
    },
    { logLabel: 'agents' },
  )

  return agents
}

async function loadAgentFromFile(
  filePath: string,
  pluginName: string,
  namespace: string[],
  sourceName: string,
  pluginPath: string,
  loadedPaths: Set<string>,
): Promise<AgentDefinition | null> {
  const fs = getFsImplementation()

  if (isDuplicatePath(fs, filePath, loadedPaths)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, { encoding: 'utf-8' })
    const { frontmatter, content: markdownContent } = parseFrontmatter(content, filePath)

    const baseAgentName = (frontmatter.name as string) || basename(filePath).replace(/\.md$/, '')

    const nameParts = [pluginName, ...namespace, baseAgentName]
    const agentType = nameParts.join(':')

    const whenToUse =
      (frontmatter.description as string) ||
      (frontmatter['when-to-use'] as string) ||
      `Agent from ${pluginName} plugin`

    let tools = parseAgentToolsFromFrontmatter(frontmatter.tools)
    const skills = parseSlashCommandToolsFromFrontmatter(frontmatter.skills)
    const color = frontmatter.color as string | undefined
    const modelRaw = frontmatter.model

    let model: string | undefined
    if (typeof modelRaw === 'string' && modelRaw.trim().length > 0) {
      const trimmed = modelRaw.trim()
      model = trimmed.toLowerCase() === 'inherit' ? 'inherit' : trimmed
    }

    const backgroundRaw = frontmatter.background
    const background = backgroundRaw === 'true' || backgroundRaw === true ? true : undefined

    let systemPrompt = markdownContent.trim()

    const memoryRaw = frontmatter.memory as string | undefined
    let memory: AgentMemoryScope | undefined
    if (memoryRaw !== undefined) {
      if (VALID_MEMORY_SCOPES.includes(memoryRaw as AgentMemoryScope)) {
        memory = memoryRaw as AgentMemoryScope
      } else {
        logForDebugging(
          `Plugin agent file ${filePath} has invalid memory value '${memoryRaw}'. Valid options: ${VALID_MEMORY_SCOPES.join(', ')}`,
        )
      }
    }

    const isolationRaw = frontmatter.isolation as string | undefined
    const isolation = isolationRaw === 'worktree' ? ('worktree' as const) : undefined

    const effortRaw = frontmatter.effort
    const effort = effortRaw !== undefined ? parseEffortValue(effortRaw) : undefined
    if (effortRaw !== undefined && effort === undefined) {
      logForDebugging(
        `Plugin agent file ${filePath} has invalid effort '${effortRaw}'. Valid options: ${EFFORT_LEVELS.join(', ')} or an integer`,
      )
    }

    const disallowedTools =
      frontmatter.disallowedTools !== undefined
        ? parseAgentToolsFromFrontmatter(frontmatter.disallowedTools)
        : undefined

    const maxTurnsRaw = frontmatter.maxTurns
    const maxTurns =
      maxTurnsRaw !== undefined && typeof maxTurnsRaw === 'number' && maxTurnsRaw > 0 ? maxTurnsRaw : undefined
    if (maxTurnsRaw !== undefined && maxTurns === undefined) {
      logForDebugging(`Plugin agent file ${filePath} has invalid maxTurns '${maxTurnsRaw}'. Must be a positive integer.`)
    }

    return {
      agentType,
      whenToUse,
      tools,
      skills,
      disallowedTools,
      getSystemPrompt: () => systemPrompt,
      source: 'plugin',
      color,
      model,
      filename: baseAgentName,
      plugin: sourceName,
      background,
      memory,
      isolation,
      effort,
      maxTurns,
    } as AgentDefinition
  } catch (error) {
    logForDebugging(`Failed to load agent from ${filePath}: ${error}`, { level: 'error' })
    return null
  }
}

export const loadPluginAgents = memoize(async (): Promise<AgentDefinition[]> => {
  const { enabled, errors } = await loadAllPluginsCacheOnly()

  if (errors.length > 0) {
    logForDebugging(`Plugin loading errors: ${errors.map(e => getPluginErrorMessage(e)).join(', ')}`)
  }

  const perPluginAgents = await Promise.all(
    enabled.map(async (plugin): Promise<AgentDefinition[]> => {
      const loadedPaths = new Set<string>()
      const pluginAgents: AgentDefinition[] = []

      if (plugin.agentsPath) {
        try {
          const agents = await loadAgentsFromDirectory(
            plugin.agentsPath,
            plugin.name,
            plugin.source,
            plugin.path,
            loadedPaths,
          )
          pluginAgents.push(...agents)

          if (agents.length > 0) {
            logForDebugging(`Loaded ${agents.length} agents from plugin ${plugin.name} default directory`)
          }
        } catch (error) {
          logForDebugging(`Failed to load agents from plugin ${plugin.name} default directory: ${error}`, { level: 'error' })
        }
      }

      if (plugin.agentsPaths) {
        const pathResults = await Promise.all(
          plugin.agentsPaths.map(async (agentPath): Promise<AgentDefinition[]> => {
            try {
              const fs = getFsImplementation()
              const stats = await fs.stat(agentPath)

              if (stats.isDirectory()) {
                const agents = await loadAgentsFromDirectory(
                  agentPath,
                  plugin.name,
                  plugin.source,
                  plugin.path,
                  loadedPaths,
                )

                if (agents.length > 0) {
                  logForDebugging(`Loaded ${agents.length} agents from plugin ${plugin.name} custom path: ${agentPath}`)
                }
                return agents
              } else if (stats.isFile() && agentPath.endsWith('.md')) {
                const agent = await loadAgentFromFile(agentPath, plugin.name, [], plugin.source, plugin.path, loadedPaths)
                if (agent) {
                  logForDebugging(`Loaded agent from plugin ${plugin.name} custom file: ${agentPath}`)
                  return [agent]
                }
              }
              return []
            } catch (error) {
              logForDebugging(`Failed to load agents from plugin ${plugin.name} custom path ${agentPath}: ${error}`, {
                level: 'error',
              })
              return []
            }
          }),
        )

        for (const agents of pathResults) {
          pluginAgents.push(...agents)
        }
      }

      return pluginAgents
    }),
  )

  const allAgents = perPluginAgents.flat()
  logForDebugging(`Total plugin agents loaded: ${allAgents.length}`)
  return allAgents
})

export function clearPluginAgentCache(): void {
  loadPluginAgents.cache?.clear?.()
}

export async function getPluginAgentByType(agentType: string): Promise<AgentDefinition | null> {
  const agents = await loadPluginAgents()
  return agents.find(a => a.agentType === agentType) || null
}

export async function getAllPluginAgents(): Promise<AgentDefinition[]> {
  return loadPluginAgents()
}