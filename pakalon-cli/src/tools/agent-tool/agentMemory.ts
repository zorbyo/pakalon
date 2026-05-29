/**
 * Agent Memory Management
 * Handles persistent memory for agents across sessions
 */
import type { AgentMemoryScope } from './types.js';
import logger from '@/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const MEMORY_DIR = '.agent-memory';

interface AgentMemory {
  agentType: string;
  scope: AgentMemoryScope;
  content: string;
  lastUpdated: string;
}

async function getMemoryDir(scope: AgentMemoryScope): Promise<string> {
  const cwd = process.cwd();
  const scopeDir = path.join(cwd, MEMORY_DIR, scope);
  await fs.mkdir(scopeDir, { recursive: true });
  return scopeDir;
}

async function getMemoryFilePath(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<string> {
  const dir = await getMemoryDir(scope);
  const safeName = agentType.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(dir, `${safeName}.md`);
}

export async function loadAgentMemory(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<string | null> {
  try {
    const filePath = await getMemoryFilePath(agentType, scope);
    const content = await fs.readFile(filePath, 'utf-8');
    logger.debug(`[AgentMemory] Loaded memory for ${agentType} (${scope})`);
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.error(`[AgentMemory] Error loading memory for ${agentType}: ${error}`);
    return null;
  }
}

export async function saveAgentMemory(
  agentType: string,
  scope: AgentMemoryScope,
  content: string,
): Promise<void> {
  try {
    const filePath = await getMemoryFilePath(agentType, scope);
    const memory: AgentMemory = {
      agentType,
      scope,
      content,
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(filePath, content, 'utf-8');
    logger.debug(`[AgentMemory] Saved memory for ${agentType} (${scope})`);
  } catch (error) {
    logger.error(`[AgentMemory] Error saving memory for ${agentType}: ${error}`);
    throw error;
  }
}

export async function deleteAgentMemory(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<void> {
  try {
    const filePath = await getMemoryFilePath(agentType, scope);
    await fs.unlink(filePath);
    logger.debug(`[AgentMemory] Deleted memory for ${agentType} (${scope})`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`[AgentMemory] Error deleting memory for ${agentType}: ${error}`);
      throw error;
    }
  }
}

export async function listAgentMemories(
  scope: AgentMemoryScope,
): Promise<Array<{ agentType: string; lastUpdated: string }>> {
  try {
    const dir = await getMemoryDir(scope);
    const files = await fs.readdir(dir);

    const memories = await Promise.all(
      files
        .filter(f => f.endsWith('.md'))
        .map(async f => {
          const filePath = path.join(dir, f);
          const stats = await fs.stat(filePath);
          const agentType = f.replace(/\.md$/, '').replace(/_/g, '-');
          return {
            agentType,
            lastUpdated: stats.mtime.toISOString(),
          };
        }),
    );

    return memories;
  } catch (error) {
    logger.error(`[AgentMemory] Error listing memories: ${error}`);
    return [];
  }
}

export function loadAgentMemoryPrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  return `\n\n## Agent Memory
This agent has access to persistent memory from previous sessions.
Memory scope: ${scope}
Load memory using the loadAgentMemory tool if needed.`;
}

export async function hasAgentMemory(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<boolean> {
  const memory = await loadAgentMemory(agentType, scope);
  return memory !== null && memory.length > 0;
}

export async function getMemorySize(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<number> {
  try {
    const filePath = await getMemoryFilePath(agentType, scope);
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

export async function clearAllMemory(scope?: AgentMemoryScope): Promise<void> {
  try {
    const cwd = process.cwd();
    const baseDir = path.join(cwd, MEMORY_DIR);

    if (scope) {
      const dir = path.join(baseDir, scope);
      await fs.rm(dir, { recursive: true, force: true });
    } else {
      await fs.rm(baseDir, { recursive: true, force: true });
    }

    logger.info(`[AgentMemory] Cleared all memory${scope ? ` (${scope})` : ''}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`[AgentMemory] Error clearing memory: ${error}`);
      throw error;
    }
  }
}

export { MEMORY_DIR };
export type { AgentMemory, AgentMemoryScope };