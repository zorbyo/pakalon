import * as fs from 'fs';
import * as path from 'path';
import type { AgentMemoryScope } from './types.js';
import { getAgentMemoryDir } from './agentMemory.js';

const SNAPSHOT_BASE = 'agent-memory-snapshots';
const SNAPSHOT_JSON = 'snapshot.json';
const SYNCED_JSON = '.snapshot-synced.json';

interface SnapshotMeta {
  updatedAt: string;
}

interface SyncedMeta {
  syncedFrom: string;
}

function getSnapshotDirForAgent(agentType: string): string {
  return path.join(process.cwd(), '.agents', SNAPSHOT_BASE, agentType.replace(/:/g, '-'));
}

function getSnapshotJsonPath(agentType: string): string {
  return path.join(getSnapshotDirForAgent(agentType), SNAPSHOT_JSON);
}

function getSyncedJsonPath(agentType: string, scope: AgentMemoryScope): string {
  const dirName = agentType.replace(/:/g, '-');
  switch (scope) {
    case 'user':
      return path.join(path.join(process.cwd(), '.agents', 'memory', dirName), SYNCED_JSON);
    case 'project':
      return path.join(path.join(process.cwd(), '.agents', 'memory', dirName), SYNCED_JSON);
    case 'local':
      return path.join(path.join(process.cwd(), '.agents', 'memory-local', dirName), SYNCED_JSON);
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, { encoding: 'utf-8' });
    const result = JSON.parse(content);
    return result as T;
  } catch {
    return null;
  }
}

async function copySnapshotToLocal(
  agentType: string,
  scope: AgentMemoryScope
): Promise<void> {
  const snapshotMemDir = getSnapshotDirForAgent(agentType);
  const localMemDir = getAgentMemoryDir(agentType, scope);

  await fs.promises.mkdir(localMemDir, { recursive: true });

  try {
    const files = await fs.promises.readdir(snapshotMemDir, { withFileTypes: true });
    for (const dirent of files) {
      if (!dirent.isFile() || dirent.name === SNAPSHOT_JSON) continue;
      const content = await fs.promises.readFile(
        path.join(snapshotMemDir, dirent.name),
        { encoding: 'utf-8' }
      );
      await fs.promises.writeFile(path.join(localMemDir, dirent.name), content);
    }
  } catch (e) {
    console.warn(`Failed to copy snapshot to local agent memory: ${e}`);
  }
}

async function saveSyncedMeta(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string
): Promise<void> {
  const syncedPath = getSyncedJsonPath(agentType, scope);
  const localMemDir = getAgentMemoryDir(agentType, scope);
  await fs.promises.mkdir(localMemDir, { recursive: true });
  const meta: SyncedMeta = { syncedFrom: snapshotTimestamp };
  try {
    await fs.promises.writeFile(syncedPath, JSON.stringify(meta));
  } catch (e) {
    console.warn(`Failed to save snapshot sync metadata: ${e}`);
  }
}

export async function checkAgentMemorySnapshot(
  agentType: string,
  scope: AgentMemoryScope
): Promise<{ action: 'none' | 'initialize' | 'prompt-update'; snapshotTimestamp?: string }> {
  const snapshotMeta = await readJsonFile<SnapshotMeta>(getSnapshotJsonPath(agentType));

  if (!snapshotMeta) {
    return { action: 'none' };
  }

  const localMemDir = getAgentMemoryDir(agentType, scope);

  let hasLocalMemory = false;
  try {
    const dirents = await fs.promises.readdir(localMemDir, { withFileTypes: true });
    hasLocalMemory = dirents.some((d) => d.isFile() && d.name.endsWith('.md'));
  } catch {
    // Directory doesn't exist
  }

  if (!hasLocalMemory) {
    return { action: 'initialize', snapshotTimestamp: snapshotMeta.updatedAt };
  }

  const syncedMeta = await readJsonFile<SyncedMeta>(getSyncedJsonPath(agentType, scope));

  if (!syncedMeta || new Date(snapshotMeta.updatedAt) > new Date(syncedMeta.syncedFrom)) {
    return {
      action: 'prompt-update',
      snapshotTimestamp: snapshotMeta.updatedAt,
    };
  }

  return { action: 'none' };
}

export async function initializeFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string
): Promise<void> {
  console.log(`Initializing agent memory for ${agentType} from project snapshot`);
  await copySnapshotToLocal(agentType, scope);
  await saveSyncedMeta(agentType, scope, snapshotTimestamp);
}

export async function replaceFromSnapshot(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string
): Promise<void> {
  console.log(`Replacing agent memory for ${agentType} with project snapshot`);

  const localMemDir = getAgentMemoryDir(agentType, scope);
  try {
    const existing = await fs.promises.readdir(localMemDir, { withFileTypes: true });
    for (const dirent of existing) {
      if (dirent.isFile() && dirent.name.endsWith('.md')) {
        await fs.promises.unlink(path.join(localMemDir, dirent.name));
      }
    }
  } catch {
    // Directory may not exist yet
  }

  await copySnapshotToLocal(agentType, scope);
  await saveSyncedMeta(agentType, scope, snapshotTimestamp);
}

export async function markSnapshotSynced(
  agentType: string,
  scope: AgentMemoryScope,
  snapshotTimestamp: string
): Promise<void> {
  await saveSyncedMeta(agentType, scope, snapshotTimestamp);
}