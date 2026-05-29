import * as fs from 'fs';
import * as path from 'path';
import logger from '@/utils/logger.js';

export interface FilePersistenceEntry {
  path: string;
  originalContent: string;
  modifiedContent: string;
  timestamp: string;
  sessionId: string;
}

export interface FilePersistenceConfig {
  enabled: boolean;
  persistDir: string;
  maxEntries: number;
  autoCleanup: boolean;
}

const DEFAULT_CONFIG: FilePersistenceConfig = {
  enabled: true,
  persistDir: '.pakalon/file-persistence',
  maxEntries: 100,
  autoCleanup: true,
};

let config: FilePersistenceConfig = { ...DEFAULT_CONFIG };
let entries: FilePersistenceEntry[] = [];

export function initFilePersistence(cfg?: Partial<FilePersistenceConfig>): void {
  config = { ...config, ...cfg };

  if (!fs.existsSync(config.persistDir)) {
    fs.mkdirSync(config.persistDir, { recursive: true });
  }

  loadEntries();
}

async function loadEntries(): Promise<void> {
  const entriesFile = path.join(config.persistDir, 'entries.json');

  if (fs.existsSync(entriesFile)) {
    try {
      const content = await fs.promises.readFile(entriesFile, 'utf-8');
      entries = JSON.parse(content);
    } catch (err) {
      logger.warn('Failed to load file persistence entries:', err);
      entries = [];
    }
  }
}

async function saveEntries(): Promise<void> {
  const entriesFile = path.join(config.persistDir, 'entries.json');

  try {
    await fs.promises.writeFile(entriesFile, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save file persistence entries:', err);
  }
}

export function recordFileChange(
  filePath: string,
  originalContent: string,
  modifiedContent: string,
  sessionId?: string
): void {
  if (!config.enabled) {
    return;
  }

  const entry: FilePersistenceEntry = {
    path: path.normalize(filePath),
    originalContent,
    modifiedContent,
    timestamp: new Date().toISOString(),
    sessionId: sessionId || 'default',
  };

  entries.push(entry);

  if (config.autoCleanup && entries.length > config.maxEntries) {
    entries = entries.slice(-config.maxEntries);
  }

  saveEntries();
  persistEntry(entry);
}

async function persistEntry(entry: FilePersistenceEntry): Promise<void> {
  const entryFile = path.join(config.persistDir, `${Buffer.from(entry.path).toString('base64').slice(0, 50)}.json`);

  try {
    await fs.promises.writeFile(entryFile, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`Failed to persist entry for ${entry.path}:`, err);
  }
}

export function getFileHistory(filePath: string): FilePersistenceEntry[] {
  const normalized = path.normalize(filePath);
  return entries.filter((e) => e.path === normalized);
}

export function getOriginalContent(filePath: string): string | null {
  const history = getFileHistory(filePath);
  if (history.length === 0) {
    return null;
  }
  return history[0].originalContent;
}

export function getPreviousVersion(filePath: string, versionIndex: number = -2): string | null {
  const history = getFileHistory(filePath);
  if (history.length < Math.abs(versionIndex) + 1) {
    return null;
  }
  return history[history.length + versionIndex].modifiedContent;
}

export async function revertToVersion(filePath: string, versionIndex: number = -2): Promise<boolean> {
  const content = getPreviousVersion(filePath, versionIndex);
  if (content === null) {
    return false;
  }

  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logger.error(`Failed to revert ${filePath}:`, err);
    return false;
  }
}

export function clearFileHistory(filePath?: string): void {
  if (filePath) {
    const normalized = path.normalize(filePath);
    entries = entries.filter((e) => e.path !== normalized);
  } else {
    entries = [];
  }
  saveEntries();
}

export function getAllHistory(): FilePersistenceEntry[] {
  return [...entries];
}

export function getSessionHistory(sessionId: string): FilePersistenceEntry[] {
  return entries.filter((e) => e.sessionId === sessionId);
}

export function getPersistenceStats(): {
  totalEntries: number;
  uniqueFiles: number;
  diskUsage: number;
  oldestEntry: string | null;
  newestEntry: string | null;
} {
  const uniqueFiles = new Set(entries.map((e) => e.path)).size;
  const oldest = entries.length > 0 ? entries[0].timestamp : null;
  const newest = entries.length > 0 ? entries[entries.length - 1].timestamp : null;

  let diskUsage = 0;
  try {
    const files = fs.readdirSync(config.persistDir);
    for (const file of files) {
      const stat = fs.statSync(path.join(config.persistDir, file));
      diskUsage += stat.size;
    }
  } catch {
  }

  return {
    totalEntries: entries.length,
    uniqueFiles,
    diskUsage,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

export function enableFilePersistence(): void {
  config.enabled = true;
}

export function disableFilePersistence(): void {
  config.enabled = false;
}

export function isFilePersistenceEnabled(): boolean {
  return config.enabled;
}