/**
 * Load Agent Definitions
 * Loads built-in agents and custom agents from directories
 */
import { getBuiltInAgents } from './builtInAgents.js';
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
  CustomAgentDefinition,
  AgentColorName,
  AgentMemoryScope,
  AgentMcpServerSpec,
  EffortValue,
  PermissionMode,
} from './types.js';
import { AGENT_COLORS } from './constants.js';
import logger from '@/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

interface AgentDefinitionsResult {
  activeAgents: AgentDefinition[];
  allAgents: AgentDefinition[];
  failedFiles?: Array<{ path: string; error: string }>;
}

interface MarkdownFile {
  filePath: string;
  baseDir: string;
  frontmatter: Record<string, unknown>;
  content: string;
  source: string;
}

const EFFORT_LEVELS = ['minimum', 'low', 'medium', 'high', 'maximum'] as const;

const PERMISSION_MODES = [
  'acceptEdits',
  'ask',
  'auto',
  'bypassPermissions',
  'bubble',
  'plan',
  'restrictToolUse',
] as const;

function parseAgentFromMarkdown(
  filePath: string,
  baseDir: string,
  frontmatter: Record<string, unknown>,
  content: string,
  source: string,
): CustomAgentDefinition | null {
  try {
    const agentType = frontmatter['name'];
    let whenToUse = frontmatter['description'] as string;

    if (!agentType || typeof agentType !== 'string') {
      return null;
    }
    if (!whenToUse || typeof whenToUse !== 'string') {
      logger.debug(`Agent file ${filePath} is missing required 'description' in frontmatter`);
      return null;
    }

    whenToUse = whenToUse.replace(/\\n/g, '\n');

    const color = frontmatter['color'] as AgentColorName | undefined;
    const modelRaw = frontmatter['model'];
    let model: string | undefined;
    if (typeof modelRaw === 'string' && modelRaw.trim().length > 0) {
      const trimmed = modelRaw.trim();
      model = trimmed.toLowerCase() === 'inherit' ? 'inherit' : trimmed;
    }

    const backgroundRaw = frontmatter['background'];
    const background =
      backgroundRaw === 'true' || backgroundRaw === true ? true : undefined;

    const memoryRaw = frontmatter['memory'] as string | undefined;
    let memory: AgentMemoryScope | undefined;
    if (memoryRaw !== undefined) {
      const VALID_MEMORY_SCOPES: AgentMemoryScope[] = ['user', 'project', 'local'];
      if (VALID_MEMORY_SCOPES.includes(memoryRaw as AgentMemoryScope)) {
        memory = memoryRaw as AgentMemoryScope;
      }
    }

    const isolationRaw = frontmatter['isolation'] as string | undefined;
    let isolation: 'worktree' | 'remote' | undefined;
    if (isolationRaw !== undefined) {
      if (isolationRaw === 'worktree' || isolationRaw === 'remote') {
        isolation = isolationRaw;
      }
    }

    const effortRaw = frontmatter['effort'];
    let effort: EffortValue | undefined;
    if (effortRaw !== undefined) {
      if (EFFORT_LEVELS.includes(effortRaw as EffortValue)) {
        effort = effortRaw as EffortValue;
      }
    }

    const permissionModeRaw = frontmatter['permissionMode'] as string | undefined;
    let permissionMode: PermissionMode | undefined;
    if (permissionModeRaw && PERMISSION_MODES.includes(permissionModeRaw as PermissionMode)) {
      permissionMode = permissionModeRaw as PermissionMode;
    }

    const maxTurnsRaw = frontmatter['maxTurns'];
    const maxTurns =
      typeof maxTurnsRaw === 'number' && maxTurnsRaw > 0 ? maxTurnsRaw : undefined;

    const toolsRaw = frontmatter['tools'];
    let tools: string[] | undefined;
    if (Array.isArray(toolsRaw)) {
      tools = toolsRaw.map(String);
    }

    const disallowedToolsRaw = frontmatter['disallowedTools'];
    let disallowedTools: string[] | undefined;
    if (Array.isArray(disallowedToolsRaw)) {
      disallowedTools = disallowedToolsRaw.map(String);
    }

    const skillsRaw = frontmatter['skills'];
    let skills: string[] | undefined;
    if (Array.isArray(skillsRaw)) {
      skills = skillsRaw.map(String);
    }

    const mcpServersRaw = frontmatter['mcpServers'];
    let mcpServers: AgentMcpServerSpec[] | undefined;
    if (Array.isArray(mcpServersRaw)) {
      mcpServers = mcpServersRaw as AgentMcpServerSpec[];
    }

    const initialPromptRaw = frontmatter['initialPrompt'];
    const initialPrompt =
      typeof initialPromptRaw === 'string' && initialPromptRaw.trim()
        ? initialPromptRaw
        : undefined;

    const filename = path.basename(filePath, '.md');
    const systemPrompt = content.trim();

    const agentDef: CustomAgentDefinition = {
      baseDir,
      agentType: agentType,
      whenToUse: whenToUse,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      ...(mcpServers !== undefined && mcpServers.length > 0 ? { mcpServers } : {}),
      getSystemPrompt: () => systemPrompt,
      source: source as CustomAgentDefinition['source'],
      filename,
      ...(color && typeof color === 'string' && AGENT_COLORS.includes(color as AgentColorName)
        ? { color: color as AgentColorName }
        : {}),
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(background ? { background } : {}),
      ...(memory ? { memory } : {}),
      ...(isolation ? { isolation } : {}),
    };

    return agentDef;
  } catch (error) {
    logger.error(`Error parsing agent from ${filePath}: ${error}`);
    return null;
  }
}

async function loadMarkdownFilesForSubdir(
  subdir: string,
  cwd: string,
): Promise<MarkdownFile[]> {
  const agentsDir = path.join(cwd, subdir);
  const files: MarkdownFile[] = [];

  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(agentsDir, entry.name);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);
          files.push({
            filePath,
            baseDir: agentsDir,
            frontmatter,
            content: body,
            source: 'userSettings',
          });
        } catch (error) {
          logger.debug(`Error reading agent file ${filePath}: ${error}`);
        }
      }
    }
  } catch (error) {
    logger.debug(`Agent directory not found: ${agentsDir}`);
  }

  return files;
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterStr, body] = match;
  const frontmatter: Record<string, unknown> = {};

  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value: unknown = line.substring(colonIndex + 1).trim();

    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (!isNaN(Number(value)) && value !== '') {
      value = Number(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

export async function loadAgentsDir(): Promise<AgentDefinition[]> {
  const cwd = process.cwd();
  const markdownFiles = await loadMarkdownFilesForSubdir('agents', cwd);

  const customAgents = markdownFiles
    .map(({ filePath, baseDir, frontmatter, content, source }) => {
      return parseAgentFromMarkdown(filePath, baseDir, frontmatter, content, source);
    })
    .filter((agent): agent is CustomAgentDefinition => agent !== null);

  return customAgents;
}

export async function getAgentDefinitions(cwd?: string): Promise<AgentDefinitionsResult> {
  const workingDir = cwd || process.cwd();

  try {
    const markdownFiles = await loadMarkdownFilesForSubdir('agents', workingDir);

    const failedFiles: Array<{ path: string; error: string }> = [];
    const customAgents = markdownFiles
      .map(({ filePath, baseDir, frontmatter, content, source }) => {
        const agent = parseAgentFromMarkdown(filePath, baseDir, frontmatter, content, source);
        if (!agent && frontmatter['name']) {
          failedFiles.push({
            path: filePath,
            error: 'Missing required fields',
          });
        }
        return agent;
      })
      .filter((agent): agent is CustomAgentDefinition => agent !== null);

    const builtInAgents = getBuiltInAgents();

    const allAgentsList: AgentDefinition[] = [
      ...builtInAgents,
      ...customAgents,
    ];

    return {
      activeAgents: allAgentsList,
      allAgents: allAgentsList,
      failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
    };
  } catch (error) {
    logger.error(`Error loading agent definitions: ${error}`);
    const builtInAgents = getBuiltInAgents();
    return {
      activeAgents: builtInAgents,
      allAgents: builtInAgents,
    };
  }
}

export function getActiveAgentsFromList(allAgents: AgentDefinition[]): AgentDefinition[] {
  const builtInAgents = allAgents.filter(a => a.source === 'built-in');
  const pluginAgents = allAgents.filter(a => a.source === 'plugin');
  const userAgents = allAgents.filter(a => a.source === 'userSettings');
  const projectAgents = allAgents.filter(a => a.source === 'projectSettings');
  const managedAgents = allAgents.filter(a => a.source === 'policySettings');

  const agentMap = new Map<string, AgentDefinition>();

  for (const agents of [builtInAgents, pluginAgents, userAgents, projectAgents, managedAgents]) {
    for (const agent of agents) {
      agentMap.set(agent.agentType, agent);
    }
  }

  return Array.from(agentMap.values());
}

export function isBuiltInAgent(agent: AgentDefinition): agent is BuiltInAgentDefinition {
  return agent.source === 'built-in';
}

export function isCustomAgent(
  agent: AgentDefinition,
): agent is CustomAgentDefinition {
  return agent.source !== 'built-in' && agent.source !== 'plugin';
}

export function isPluginAgent(
  agent: AgentDefinition,
): agent is CustomAgentDefinition {
  return agent.source === 'plugin';
}

export function clearAgentDefinitionsCache(): void {
  // No-op for now, can be enhanced with memoization cache clearing
}

export { getBuiltInAgents };
export type { AgentDefinitionsResult };