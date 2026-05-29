/**
 * Agent Memory - Enhanced with Phase-specific persistence
 *
 * Features:
 * - Phase-specific memory (phase1-memory.md, phase2-memory.md, etc.)
 * - JSON storage for structured data
 * - Simple keyword-based search
 * - Memory persistence across sessions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuid } from 'uuid';
import type { AgentMemoryScope } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
  id: string;
  content: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  tags: string[];
  phase?: number;  // Phase-specific memory
}

export interface MemorySearchOptions {
  query: string;
  limit?: number;
  phase?: number;
  tags?: string[];
}

export interface MemoryStats {
  totalEntries: number;
  entriesByPhase: Record<number, number>;
  totalSize: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

// ============================================================================
// Directory Management
// ============================================================================

export function getAgentMemoryDir(agentType: string, scope: AgentMemoryScope): string {
  const dirName = agentType.replace(/:/g, '-');

  switch (scope) {
    case 'user':
      return path.join(os.homedir(), '.agents', 'memory', dirName);
    case 'project':
      return path.join(process.cwd(), '.agents', 'memory', dirName);
    case 'local':
      if (process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR) {
        return path.join(
          process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
          'projects',
          process.cwd(),
          'agent-memory-local',
          dirName
        );
      }
      return path.join(process.cwd(), '.agents', 'memory-local', dirName);
  }
}

// ============================================================================
// Phase-specific Memory
// ============================================================================

export function getPhaseMemoryDir(agentType: string, scope: AgentMemoryScope, phase: number): string {
  const baseDir = getAgentMemoryDir(agentType, scope);
  return path.join(baseDir, `phase${phase}`);
}

export function getPhaseMemoryFile(agentType: string, scope: AgentMemoryScope, phase: number): string {
  return path.join(getPhaseMemoryDir(agentType, scope, phase), 'memory.json');
}

/**
 * Save phase-specific memory
 */
export function savePhaseMemory(
  agentType: string,
  scope: AgentMemoryScope,
  phase: number,
  content: string,
  metadata: Record<string, unknown> = {},
  tags: string[] = []
): boolean {
  try {
    const phaseDir = getPhaseMemoryDir(agentType, scope, phase);
    const memoryFile = getPhaseMemoryFile(agentType, scope, phase);

    if (!fs.existsSync(phaseDir)) {
      fs.mkdirSync(phaseDir, { recursive: true });
    }

    // Load existing memory or create new
    let memory: { entries: MemoryEntry[] } = { entries: [] };

    if (fs.existsSync(memoryFile)) {
      try {
        const existing = fs.readFileSync(memoryFile, 'utf-8');
        memory = JSON.parse(existing);
      } catch {
        // Invalid JSON, start fresh
        memory = { entries: [] };
      }
    }

    // Add new entry
    const entry: MemoryEntry = {
      id: uuid(),
      content,
      timestamp: new Date().toISOString(),
      metadata,
      tags,
      phase,
    };

    memory.entries.push(entry);

    // Save updated memory
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn(`Failed to save phase ${phase} memory:`, err);
    return false;
  }
}

/**
 * Load phase-specific memory
 */
export function loadPhaseMemory(
  agentType: string,
  scope: AgentMemoryScope,
  phase: number,
  limit: number = 10
): MemoryEntry[] {
  try {
    const memoryFile = getPhaseMemoryFile(agentType, scope, phase);

    if (!fs.existsSync(memoryFile)) {
      return [];
    }

    const content = fs.readFileSync(memoryFile, 'utf-8');
    const memory = JSON.parse(content) as { entries: MemoryEntry[] };

    // Return most recent entries
    return memory.entries
      .filter(e => e.phase === phase)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  } catch (err) {
    console.warn(`Failed to load phase ${phase} memory:`, err);
    return [];
  }
}

/**
 * Clear phase-specific memory
 */
export function clearPhaseMemory(
  agentType: string,
  scope: AgentMemoryScope,
  phase?: number
): boolean {
  try {
    if (phase !== undefined) {
      const phaseDir = getPhaseMemoryDir(agentType, scope, phase);
      if (fs.existsSync(phaseDir)) {
        fs.rmSync(phaseDir, { recursive: true, force: true });
      }
    } else {
      // Clear all phase memories
      for (let p = 1; p <= 6; p++) {
        const phaseDir = getPhaseMemoryDir(agentType, scope, p);
        if (fs.existsSync(phaseDir)) {
          fs.rmSync(phaseDir, { recursive: true, force: true });
        }
      }
    }
    return true;
  } catch (err) {
    console.warn(`Failed to clear phase memory:`, err);
    return false;
  }
}

// ============================================================================
// Legacy Functions (backward compatible)
// ============================================================================

export function isAgentMemoryPath(absolutePath: string, scope?: AgentMemoryScope): boolean {
  const normalizedPath = path.normalize(absolutePath);

  const userMemoryBase = path.join(os.homedir(), '.agents', 'memory');
  if (normalizedPath.startsWith(path.join(userMemoryBase, 'agent-memory') + path.sep)) {
    return true;
  }

  const projectMemoryBase = path.join(process.cwd(), '.agents', 'memory');
  if (normalizedPath.startsWith(path.join(projectMemoryBase, 'agent-memory') + path.sep)) {
    return true;
  }

  const localMemoryBase = path.join(process.cwd(), '.agents', 'memory-local');
  if (normalizedPath.startsWith(localMemoryBase + path.sep)) {
    return true;
  }

  return false;
}

export function getAgentMemoryEntrypoint(
  agentType: string,
  scope: AgentMemoryScope
): string {
  return path.join(getAgentMemoryDir(agentType, scope), 'MEMORY.md');
}

export function getMemoryScopeDisplay(scope: AgentMemoryScope | undefined): string {
  switch (scope) {
    case 'user':
      return `User (~/.agents/memory/)`;
    case 'project':
      return 'Project (.agents/memory/)';
    case 'local':
      return `Local (.agents/memory-local/)`;
    default:
      return 'None';
  }
}

export function loadAgentMemoryPrompt(
  agentType: string,
  scope: AgentMemoryScope
): string | null {
  const memoryDir = getAgentMemoryDir(agentType, scope);
  const memoryFile = path.join(memoryDir, 'MEMORY.md');

  if (!fs.existsSync(memoryFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(memoryFile, 'utf-8');
    return content;
  } catch (err) {
    console.warn(`Failed to load agent memory from ${memoryFile}:`, err);
    return null;
  }
}

export function saveAgentMemory(
  agentType: string,
  scope: AgentMemoryScope,
  content: string
): boolean {
  const memoryDir = getAgentMemoryDir(agentType, scope);

  try {
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    const memoryFile = path.join(memoryDir, 'MEMORY.md');
    fs.writeFileSync(memoryFile, content, 'utf-8');
    return true;
  } catch (err) {
    console.warn(`Failed to save agent memory to ${scope}/${agentType}:`, err);
    return false;
  }
}

export function ensureMemoryDirExists(memoryDir: string): void {
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
}

export function getAgentMemoryFiles(scope: AgentMemoryScope, agentType?: string): string[] {
  const baseDir =
    agentType ??
    (scope === 'user'
      ? path.join(os.homedir(), '.agents', 'memory')
      : scope === 'project'
        ? path.join(process.cwd(), '.agents', 'memory')
        : path.join(process.cwd(), '.agents', 'memory-local'));

  if (!fs.existsSync(baseDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(baseDir);
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(baseDir, f));
  } catch (err) {
    console.warn(`Failed to list agent memory files for ${scope}:`, err);
    return [];
  }
}

export function clearAgentMemory(scope?: AgentMemoryScope, agentType?: string): boolean {
  try {
    if (scope && agentType) {
      const memoryDir = getAgentMemoryDir(agentType, scope);
      if (fs.existsSync(memoryDir)) {
        fs.rmSync(memoryDir, { recursive: true, force: true });
      }
    } else {
      for (const s of ['user', 'project', 'local'] as AgentMemoryScope[]) {
        const baseDir =
          s === 'user'
            ? path.join(os.homedir(), '.agents', 'memory')
            : s === 'project'
              ? path.join(process.cwd(), '.agents', 'memory')
              : path.join(process.cwd(), '.agents', 'memory-local');

        if (fs.existsSync(baseDir)) {
          if (agentType) {
            const agentDir = path.join(baseDir, agentType.replace(/:/g, '-'));
            if (fs.existsSync(agentDir)) {
              fs.rmSync(agentDir, { recursive: true, force: true });
            }
          } else {
            fs.rmSync(baseDir, { recursive: true, force: true });
          }
        }
      }
    }
    return true;
  } catch (err) {
    console.warn(`Failed to clear agent memory:`, err);
    return false;
  }
}

// ============================================================================
// New Search Functions
// ============================================================================

/**
 * Search memory entries
 */
export function searchMemory(
  agentType: string,
  scope: AgentMemoryScope,
  options: MemorySearchOptions
): MemoryEntry[] {
  try {
    const memoryDir = getAgentMemoryDir(agentType, scope);

    if (!fs.existsSync(memoryDir)) {
      return [];
    }

    const results: MemoryEntry[] = [];
    const query = options.query.toLowerCase();

    // Search all phase directories
    const phaseDirs = fs.readdirSync(memoryDir).filter(d => d.startsWith('phase'));

    for (const phaseDir of phaseDirs) {
      const memoryFile = path.join(memoryDir, phaseDir, 'memory.json');

      if (!fs.existsSync(memoryFile)) continue;

      try {
        const content = fs.readFileSync(memoryFile, 'utf-8');
        const memory = JSON.parse(content) as { entries: MemoryEntry[] };

        for (const entry of memory.entries) {
          // Filter by phase if specified
          if (options.phase !== undefined && entry.phase !== options.phase) {
            continue;
          }

          // Filter by tags if specified
          if (options.tags && options.tags.length > 0) {
            const hasTag = options.tags.some(tag => entry.tags.includes(tag));
            if (!hasTag) continue;
          }

          // Keyword search
          if (entry.content.toLowerCase().includes(query)) {
            results.push(entry);
          }
        }
      } catch {
        // Skip invalid JSON files
        continue;
      }
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    return results.slice(0, options.limit || 10);
  } catch (err) {
    console.warn(`Failed to search memory:`, err);
    return [];
  }
}

/**
 * Get memory statistics
 */
export function getMemoryStats(agentType: string, scope: AgentMemoryScope): MemoryStats {
  const stats: MemoryStats = {
    totalEntries: 0,
    entriesByPhase: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    totalSize: 0,
    oldestEntry: null,
    newestEntry: null,
  };

  try {
    const memoryDir = getAgentMemoryDir(agentType, scope);

    if (!fs.existsSync(memoryDir)) {
      return stats;
    }

    const phaseDirs = fs.readdirSync(memoryDir).filter(d => d.startsWith('phase'));

    for (const phaseDir of phaseDirs) {
      const memoryFile = path.join(memoryDir, phaseDir, 'memory.json');

      if (!fs.existsSync(memoryFile)) continue;

      try {
        const content = fs.readFileSync(memoryFile, 'utf-8');
        const memory = JSON.parse(content) as { entries: MemoryEntry[] };

        stats.totalEntries += memory.entries.length;
        stats.totalSize += content.length;

        // Count by phase
        for (const entry of memory.entries) {
          if (entry.phase && stats.entriesByPhase[entry.phase] !== undefined) {
            stats.entriesByPhase[entry.phase]++;
          }
        }

        // Track oldest/newest
        for (const entry of memory.entries) {
          if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry) {
            stats.oldestEntry = entry.timestamp;
          }
          if (!stats.newestEntry || entry.timestamp > stats.newestEntry) {
            stats.newestEntry = entry.timestamp;
          }
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.warn(`Failed to get memory stats:`, err);
  }

  return stats;
}

/**
 * Export memory to JSON
 */
export function exportMemory(agentType: string, scope: AgentMemoryScope): string {
  try {
    const memoryDir = getAgentMemoryDir(agentType, scope);

    if (!fs.existsSync(memoryDir)) {
      return JSON.stringify({ entries: [] }, null, 2);
    }

    const allEntries: MemoryEntry[] = [];
    const phaseDirs = fs.readdirSync(memoryDir).filter(d => d.startsWith('phase'));

    for (const phaseDir of phaseDirs) {
      const memoryFile = path.join(memoryDir, phaseDir, 'memory.json');

      if (!fs.existsSync(memoryFile)) continue;

      try {
        const content = fs.readFileSync(memoryFile, 'utf-8');
        const memory = JSON.parse(content) as { entries: MemoryEntry[] };
        allEntries.push(...memory.entries);
      } catch {
        continue;
      }
    }

    // Sort by timestamp
    allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return JSON.stringify({ entries: allEntries }, null, 2);
  } catch (err) {
    console.warn(`Failed to export memory:`, err);
    return JSON.stringify({ entries: [] }, null, 2);
  }
}

// ============================================================================
// Phase Memory Context Builder
// ============================================================================

/**
 * Build context string from phase memory for LLM prompts
 */
export function buildPhaseMemoryContext(
  agentType: string,
  scope: AgentMemoryScope,
  currentPhase: number,
  maxLength: number = 4000
): string {
  const entries = loadPhaseMemory(agentType, scope, currentPhase, 20);

  if (entries.length === 0) {
    return '';
  }

  const contextParts = entries.map(entry => {
    const date = new Date(entry.timestamp).toLocaleDateString();
    return `[${date}] ${entry.content}`;
  });

  let context = `## Phase ${currentPhase} Memory (from previous runs)\n\n${contextParts.join('\n\n')}`;

  // Truncate if too long
  if (context.length > maxLength) {
    context = context.substring(0, maxLength) + '\n\n...(truncated)';
  }

  return context;
}

export default {
  // Legacy exports
  getAgentMemoryDir,
  isAgentMemoryPath,
  getAgentMemoryEntrypoint,
  getMemoryScopeDisplay,
  loadAgentMemoryPrompt,
  saveAgentMemory,
  ensureMemoryDirExists,
  getAgentMemoryFiles,
  clearAgentMemory,
  // New enhanced exports
  getPhaseMemoryDir,
  getPhaseMemoryFile,
  savePhaseMemory,
  loadPhaseMemory,
  clearPhaseMemory,
  searchMemory,
  getMemoryStats,
  exportMemory,
  buildPhaseMemoryContext,
};