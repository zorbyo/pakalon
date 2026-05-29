import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  AgentDefinition,
  CustomAgentDefinition,
  BuiltInAgentDefinition,
  PluginAgentDefinition,
  AgentDefinitionsResult,
  AgentMemoryScope,
  EffortValue,
  PermissionMode,
} from './types.js';
import type { AgentColorName } from './constants.js';
import { getBuiltInAgents, clearBuiltInAgentsCache } from './builtInAgents.js';
import { setAgentColor, getAgentColor } from './agentColorManager.js';
import { AGENT_COLORS, AGENT_TOOL_NAME } from './constants.js';

const AGENTS_DIR = '.pakalon/agents';
const USER_AGENTS_DIR = path.join(os.homedir(), '.agents', 'agents');

let agentDefinitionsCache: AgentDefinition[] | null = null;

interface FrontmatterResult {
  frontmatter: Record<string, string>;
  contentStart: number;
}

function parseFrontmatter(content: string): FrontmatterResult | null {
  const lines = content.split('\n');
  let inFrontmatter = false;
  let frontmatterEnd = -1;
  const frontmatterLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter) {
      if (line.trim() === '---') {
        frontmatterEnd = i;
        break;
      }
      frontmatterLines.push(line);
    } else if (line.trim() === '---' && frontmatterEnd === -1) {
      continue;
    } else {
      break;
    }
  }

  if (frontmatterEnd === -1) {
    return null;
  }

  const frontmatter: Record<string, string> = {};
  for (const fline of frontmatterLines) {
    const colonIndex = fline.indexOf(':');
    if (colonIndex > 0) {
      const key = fline.slice(0, colonIndex).trim().toLowerCase();
      const value = fline.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter,
    contentStart: frontmatterEnd + 1,
  };
}

function parseAgentFromMarkdown(
  content: string,
  filePath: string,
  source: 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' = 'projectSettings'
): Omit<CustomAgentDefinition, 'baseDir' | 'path'> | null {
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return null;
  }

  const { frontmatter, contentStart } = parsed;

  const agentType = frontmatter.name || frontmatter.agent;
  if (!agentType) {
    return null;
  }

  const lines = content.split('\n');
  let descriptionLine: string | undefined;
  for (let i = contentStart; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('#') || l.startsWith('##')) {
      descriptionLine = l.replace(/^#+\s*/, '').trim();
      break;
    }
    if (l && !l.startsWith('```') && !l.startsWith('-') && !l.startsWith('*')) {
      descriptionLine = l;
      break;
    }
  }

  return parseAgentFields(agentType, frontmatter, descriptionLine, source);
}

function parseAgentFields(
  agentType: string,
  frontmatter: Record<string, string>,
  descriptionLine?: string,
  _source: 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' = 'projectSettings'
): Omit<CustomAgentDefinition, 'baseDir' | 'path' | 'source'> | null {
  const whenToUse = frontmatter.when_to_use || frontmatter.description || descriptionLine;

  const agent = {
    agentType,
    whenToUse,
    tools: parseListField(frontmatter.tools),
    disallowedTools: parseListField(frontmatter.disallowed_tools),
    skills: parseListField(frontmatter.skills),
    mcpServers: parseMcpServers(frontmatter.mcp_servers),
    color: parseColor(frontmatter.color),
    model: parseModel(frontmatter.model),
    effort: parseEffort(frontmatter.effort),
    permissionMode: parsePermissionMode(frontmatter.permission_mode),
    maxTurns: frontmatter.max_turns ? parseInt(frontmatter.max_turns, 10) : undefined,
    memory: parseMemory(frontmatter.memory),
    background: frontmatter.background === 'true',
    isolation: parseIsolation(frontmatter.isolation),
    omitClaudeMd: frontmatter.omit_claude_md === 'true',
    readOnly: frontmatter.read_only === 'true',
    initialPrompt: frontmatter.initial_prompt || undefined,
    requiredMcpServers: parseListField(frontmatter.required_mcp_servers),
  };

  return agent;
}

function parseListField(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseMcpServers(
  value?: string
): Array<{ type: 'reference' | 'inline'; server: string; config?: Record<string, unknown> }> | undefined {
  if (!value) return undefined;
  return value.split(',').map((s) => {
    s = s.trim();
    if (s.includes(':')) {
      const [server, config] = s.split(':');
      return { type: 'reference' as const, server: server.trim(), config: { name: config.trim() } };
    }
    return { type: 'reference' as const, server: s };
  });
}

function parseColor(value?: string): AgentColorName | undefined {
  if (!value) return undefined;
  const color = value.toLowerCase().trim();
  if ((AGENT_COLORS as readonly string[]).includes(color)) {
    return color as AgentColorName;
  }
  return undefined;
}

function parseModel(value?: string): string | undefined {
  if (!value) return undefined;
  const model = value.toLowerCase().trim();
  if (model === 'inherit' || model === 'sonnet' || model === 'opus' || model === 'haiku') {
    return model;
  }
  return value.trim() || undefined;
}

function parseEffort(value?: string): EffortValue | undefined {
  if (!value) return undefined;
  const effort = value.toLowerCase().trim();
  const validEfforts: EffortValue[] = ['minimum', 'low', 'medium', 'high', 'maximum'];
  if (validEfforts.includes(effort as EffortValue)) {
    return effort as EffortValue;
  }
  return undefined;
}

function parsePermissionMode(value?: string): PermissionMode | undefined {
  if (!value) return undefined;
  const mode = value.toLowerCase().trim();
  const validModes: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto', 'bubble'];
  if (validModes.includes(mode as PermissionMode)) {
    return mode as PermissionMode;
  }
  return undefined;
}

function parseMemory(value?: string): AgentMemoryScope | undefined {
  if (!value) return undefined;
  const memory = value.toLowerCase().trim();
  const validMemory: AgentMemoryScope[] = ['user', 'project', 'local'];
  if (validMemory.includes(memory as AgentMemoryScope)) {
    return memory as AgentMemoryScope;
  }
  return undefined;
}

function parseIsolation(value?: string): 'worktree' | 'remote' | undefined {
  if (!value) return undefined;
  const isolation = value.toLowerCase().trim();
  if (isolation === 'worktree' || isolation === 'remote') {
    return isolation;
  }
  return undefined;
}

export function loadAgentsFromDirectory(dirPath: string): AgentDefinition[] {
  const agents: AgentDefinition[] = [];

  if (!fs.existsSync(dirPath)) {
    return agents;
  }

  try {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const subAgents = loadAgentsFromDirectory(fullPath);
        agents.push(...subAgents);
      } else if (file.endsWith('.md') || file.endsWith('.yaml') || file.endsWith('.yml')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');

          if (file.endsWith('.md')) {
            const parsed = parseAgentFromMarkdown(content, fullPath);
            if (parsed) {
              const agent: CustomAgentDefinition = {
                ...parsed,
                source: 'projectSettings',
                baseDir: dirPath,
                path: fullPath,
              } as CustomAgentDefinition;
              agents.push(agent);
            }
          } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
            const parsed = parseAgentFromYaml(content, fullPath);
            if (parsed) {
              const agent: CustomAgentDefinition = {
                ...parsed,
                source: 'projectSettings',
                baseDir: dirPath,
                path: fullPath,
              } as CustomAgentDefinition;
              agents.push(agent);
            }
          }
        } catch (err) {
          logger.warn(`Failed to parse agent file ${fullPath}:`, err);
        }
      }
    }
  } catch (err) {
    logger.warn(`Failed to read agents directory ${dirPath}:`, err);
  }

  return agents;
}

function parseAgentFromYaml(
  content: string,
  _filePath: string
): Omit<CustomAgentDefinition, 'baseDir' | 'path'> | null {
  const lines = content.split('\n');
  const yamlData: Record<string, string | string[] | boolean | number | undefined> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();

      if (value === 'true') {
        yamlData[key] = true;
      } else if (value === 'false') {
        yamlData[key] = false;
      } else if (/^\d+$/.test(value)) {
        yamlData[key] = parseInt(value, 10);
      } else if (value.includes(',')) {
        yamlData[key] = value.split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        yamlData[key] = value;
      }
    }
  }

  const agentType = yamlData.name as string;
  if (!agentType) {
    return null;
  }

  return {
    agentType,
    whenToUse: yamlData.when_to_use as string | undefined,
    description: yamlData.description as string | undefined,
    tools: yamlData.tools as string[] | undefined,
    disallowedTools: yamlData.disallowed_tools as string[] | undefined,
    skills: yamlData.skills as string[] | undefined,
    mcpServers: undefined,
    color: parseColor(yamlData.color as string | undefined),
    model: parseModel(yamlData.model as string | undefined),
    effort: parseEffort(yamlData.effort as string | undefined),
    permissionMode: parsePermissionMode(yamlData.permission_mode as string | undefined),
    maxTurns: yamlData.max_turns as number | undefined,
    memory: parseMemory(yamlData.memory as string | undefined),
    background: yamlData.background as boolean | undefined,
    isolation: parseIsolation(yamlData.isolation as string | undefined),
    omitClaudeMd: yamlData.omit_claude_md as boolean | undefined,
    readOnly: yamlData.read_only as boolean | undefined,
  };
}

export function getAgentDefinitions(): AgentDefinition[] {
  if (agentDefinitionsCache) {
    return agentDefinitionsCache;
  }

  const builtIn = getBuiltInAgents();
  const projectAgents = loadAgentsFromDirectory(AGENTS_DIR);
  const userAgents = loadAgentsFromDirectory(USER_AGENTS_DIR);

  const allAgents = [...builtIn, ...projectAgents, ...userAgents];

  for (const agent of allAgents) {
    if (agent.color) {
      setAgentColor(agent.agentType, agent.color);
    }
  }

  agentDefinitionsCache = allAgents;
  return agentDefinitionsCache;
}

export function getAgentDefinition(agentType: string): AgentDefinition | undefined {
  const agents = getAgentDefinitions();
  return agents.find(
    (agent) => agent.agentType.toLowerCase() === agentType.toLowerCase()
  );
}

export function getActiveAgentsFromList(allAgents: AgentDefinition[]): AgentDefinition[] {
  const builtInAgents = allAgents.filter((a) => a.source === 'built-in');
  const pluginAgents = allAgents.filter((a) => a.source === 'plugin');
  const userAgents = allAgents.filter((a) => a.source !== 'built-in' && a.source !== 'plugin');

  const agentMap = new Map<string, AgentDefinition>();

  for (const agents of [builtInAgents, pluginAgents, userAgents]) {
    for (const agent of agents) {
      agentMap.set(agent.agentType, agent);
    }
  }

  return Array.from(agentMap.values());
}

export function clearAgentDefinitionsCache(): void {
  agentDefinitionsCache = null;
  clearBuiltInAgentsCache();
}

export function hasRequiredMcpServers(
  agent: AgentDefinition,
  availableServers: string[]
): boolean {
  if (!agent.requiredMcpServers || agent.requiredMcpServers.length === 0) {
    return true;
  }

  for (const mcpSpec of agent.requiredMcpServers) {
    if (!availableServers.some((server) => server.toLowerCase().includes(mcpSpec.toLowerCase()))) {
      return false;
    }
  }

  return true;
}

export function filterAgentsByMcpRequirements(
  agents: AgentDefinition[],
  availableServers: string[]
): AgentDefinition[] {
  return agents.filter((agent) => hasRequiredMcpServers(agent, availableServers));
}

const logger = {
  warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
};