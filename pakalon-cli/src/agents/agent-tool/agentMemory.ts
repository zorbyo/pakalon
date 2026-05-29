import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentMemoryScope } from './types.js';
import logger from '@/utils/logger.js';

export function getAgentMemoryDir(scope: AgentMemoryScope): string {
  switch (scope) {
    case 'user':
      return path.join(os.homedir(), '.agents', 'memory');
    case 'project':
      return path.join(process.cwd(), '.agents', 'memory');
    case 'local':
      return path.join(os.tmpdir(), 'pakalon-agent-memory');
  }
}

export function loadAgentMemoryPrompt(scope: AgentMemoryScope, agentType: string): string | null {
  const memoryDir = getAgentMemoryDir(scope);
  const memoryFile = path.join(memoryDir, `${agentType.toLowerCase()}.md`);

  if (!fs.existsSync(memoryFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(memoryFile, 'utf-8');
    return content;
  } catch (err) {
    logger.warn(`Failed to load agent memory from ${memoryFile}:`, err);
    return null;
  }
}

export function saveAgentMemory(scope: AgentMemoryScope, agentType: string, content: string): boolean {
  const memoryDir = getAgentMemoryDir(scope);

  try {
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const memoryFile = path.join(memoryDir, `${agentType.toLowerCase()}.md`);
    fs.writeFileSync(memoryFile, content, 'utf-8');
    return true;
  } catch (err) {
    logger.warn(`Failed to save agent memory to ${scope}/${agentType}:`, err);
    return false;
  }
}

export function isAgentMemoryPath(filePath: string, scope: AgentMemoryScope): boolean {
  const memoryDir = getAgentMemoryDir(scope);
  const normalizedFilePath = path.normalize(filePath);
  const normalizedMemoryDir = path.normalize(memoryDir);

  return normalizedFilePath.startsWith(normalizedMemoryDir + path.sep) ||
         normalizedFilePath === normalizedMemoryDir;
}

export function clearAgentMemory(scope?: AgentMemoryScope): boolean {
  try {
    if (scope) {
      const memoryDir = getAgentMemoryDir(scope);
      if (fs.existsSync(memoryDir)) {
        fs.rmSync(memoryDir, { recursive: true, force: true });
      }
    } else {
      for (const s of ['user', 'project', 'local'] as AgentMemoryScope[]) {
        const memoryDir = getAgentMemoryDir(s);
        if (fs.existsSync(memoryDir)) {
          fs.rmSync(memoryDir, { recursive: true, force: true });
        }
      }
    }
    return true;
  } catch (err) {
    logger.warn(`Failed to clear agent memory:`, err);
    return false;
  }
}

export function getAgentMemoryFiles(scope: AgentMemoryScope): string[] {
  const memoryDir = getAgentMemoryDir(scope);

  if (!fs.existsSync(memoryDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(memoryDir);
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(memoryDir, f));
  } catch (err) {
    logger.warn(`Failed to list agent memory files for ${scope}:`, err);
    return [];
  }
}