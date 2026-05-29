/**
 * Agent Memory Snapshot
 * Handles agent memory snapshots for persistence and recovery
 */
import type { AgentMemoryScope } from './types.js';
import logger from '@/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const SNAPSHOT_DIR = '.agent-memory-snapshots';

interface MemorySnapshot {
  agentType: string;
  scope: AgentMemoryScope;
  content: string;
  timestamp: string;
  version: number;
}

interface SnapshotCheckResult {
  action: 'initialize' | 'prompt-update' | 'none';
  snapshotTimestamp?: string;
}

async function getSnapshotDir(scope: AgentMemoryScope): Promise<string> {
  const cwd = process.cwd();
  const scopeDir = path.join(cwd, SNAPSHOT_DIR, scope);
  await fs.mkdir(scopeDir, { recursive: true });
  return scopeDir;
}

async function getSnapshotFilePath(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<string> {
  const dir = await getSnapshotDir(scope);
  const safeName = agentType.replace(/[^a-zA-Z0-9-_]/g, '_');
  return path.join(dir, `${safeName}.json`);
}

async function getSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<MemorySnapshot | null> {
  try {
    const filePath = await getSnapshotFilePath(agentType, scope);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as MemorySnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.error(`[AgentMemorySnapshot] Error reading snapshot: ${error}`);
    return null;
  }
}

async function saveSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  content: string,
): Promise<void> {
  try {
    const existingSnapshot = await getSnapshot(agentType, scope);
    const snapshot: MemorySnapshot = {
      agentType,
      scope,
      content,
      timestamp: new Date().toISOString(),
      version: existingSnapshot ? existingSnapshot.version + 1 : 1,
    };

    const filePath = await getSnapshotFilePath(agentType, scope);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    logger.debug(`[AgentMemorySnapshot] Saved snapshot for ${agentType}`);
  } catch (error) {
    logger.error(`[AgentMemorySnapshot] Error saving snapshot: ${error}`);
    throw error;
  }
}

export async function checkAgentMemorySnapshot(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<SnapshotCheckResult> {
  try {
    const memoryFilePath = path.join(
      process.cwd(),
      '.agent-memory',
      scope,
      `${agentType.replace(/[^a-zA-Z0-9-_]/g, '_')}.md`,
    );

    let memoryExists = false;
    let memoryModifiedTime: Date | null = null;

    try {
      const stats = await fs.stat(memoryFilePath);
      memoryExists = true;
      memoryModifiedTime = stats.mtime;
    } catch {
      memoryExists = false;
    }

    const snapshot = await getSnapshot(agentType, scope);

    if (!snapshot) {
      if (memoryExists) {
        return { action: 'initialize' };
      }
      return { action: 'none' };
    }

    if (!memoryExists) {
      return {
        action: 'initialize',
        snapshotTimestamp: snapshot.timestamp,
      };
    }

    const snapshotTime = new Date(snapshot.timestamp);
    if (memoryModifiedTime && memoryModifiedTime > snapshotTime) {
      return {
        action: 'prompt-update',
        snapshotTimestamp: snapshot.timestamp,
      };
    }

    return { action: 'none' };
  } catch (error) {
    logger.error(`[AgentMemorySnapshot] Error checking snapshot: ${error}`);
    return { action: 'none' };
  }
}

export async function initializeFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string,
): Promise<void> {
  try {
    const snapshot = await getSnapshot(agentType, scope);

    if (!snapshot) {
      logger.warn(`[AgentMemorySnapshot] No snapshot found for ${agentType}`);
      return;
    }

    if (snapshot.timestamp !== snapshotTimestamp) {
      logger.warn(`[AgentMemorySnapshot] Snapshot timestamp mismatch`);
      return;
    }

    const { saveAgentMemory } = await import('./agentMemory.js');
    await saveAgentMemory(agentType, scope, snapshot.content);
    logger.info(`[AgentMemorySnapshot] Initialized memory from snapshot`);
  } catch (error) {
    logger.error(`[AgentMemorySnapshot] Error initializing from snapshot: ${error}`);
    throw error;
  }
}

export async function createSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  content: string,
): Promise<MemorySnapshot> {
  await saveSnapshot(agentType, scope, content);
  const snapshot = await getSnapshot(agentType, scope);
  if (!snapshot) {
    throw new Error('Failed to create snapshot');
  }
  return snapshot;
}

export async function deleteSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<void> {
  try {
    const filePath = await getSnapshotFilePath(agentType, scope);
    await fs.unlink(filePath);
    logger.debug(`[AgentMemorySnapshot] Deleted snapshot for ${agentType}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`[AgentMemorySnapshot] Error deleting snapshot: ${error}`);
      throw error;
    }
  }
}

export async function listSnapshots(
  scope: AgentMemoryScope,
): Promise<Array<{ agentType: string; timestamp: string; version: number }>> {
  try {
    const dir = await getSnapshotDir(scope);
    const files = await fs.readdir(dir);

    const snapshots = await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          const filePath = path.join(dir, f);
          const content = await fs.readFile(filePath, 'utf-8');
          const snapshot = JSON.parse(content) as MemorySnapshot;
          return {
            agentType: snapshot.agentType,
            timestamp: snapshot.timestamp,
            version: snapshot.version,
          };
        }),
    );

    return snapshots;
  } catch (error) {
    logger.error(`[AgentMemorySnapshot] Error listing snapshots: ${error}`);
    return [];
  }
}

export async function restoreFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
): Promise<string | null> {
  try {
    const snapshot = await getSnapshot(agentType, scope);
    if (!snapshot) {
      logger.warn(`[AgentMemorySnapshot] No snapshot found for ${agentType}`);
      return null;
    }

    const { saveAgentMemory } = await import('./agentMemory.js');
    await saveAgentMemory(agentType, scope, snapshot.content);
    logger.info(`[AgentMemorySnapshot] Restored memory from snapshot`);
    return snapshot.content;
  } catch (error) {
    logger.error(`[AgentMemorySnapshot] Error restoring from snapshot: ${error}`);
    return null;
  }
}

export { SNAPSHOT_DIR };
export type { MemorySnapshot, SnapshotCheckResult };