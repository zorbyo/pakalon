/**
 * File Persistence
 * 
 * Manages persistence of file changes for session recovery.
 * Tracks modified files and enables rollback to previous versions.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import logger from '../utils/logger.js';
import type {
  FilePersistenceEntry,
  FilePersistenceConfig,
} from './types.js';

const DEFAULT_CONFIG: FilePersistenceConfig = {
  enabled: true,
  persistDir: '.pakalon/file-persistence',
  maxEntries: 100,
  autoCleanup: true,
};

let config: FilePersistenceConfig = { ...DEFAULT_CONFIG };
let entries: FilePersistenceEntry[] = [];

const OUTPUTS_SUBDIR = 'outputs';
const FILE_COUNT_LIMIT = 1000;
const DEFAULT_UPLOAD_CONCURRENCY = 5;

export interface PersistedFile {
  filename: string;
  file_id?: string;
}

export interface FailedPersistence {
  filename: string;
  error: string;
}

export interface FilesPersistedEventData {
  files: PersistedFile[];
  failed: FailedPersistence[];
}

type TurnStartTime = number;

/**
 * Initialize file persistence
 */
export function initFilePersistence(cfg?: Partial<FilePersistenceConfig>): void {
  config = { ...config, ...cfg };

  if (!fs.existsSync(config.persistDir)) {
    fs.mkdirSync(config.persistDir, { recursive: true });
  }

  loadEntries().catch((err) => {
    logger.warn('Failed to load file persistence entries:', err);
  });
}

/**
 * Load entries from disk
 */
async function loadEntries(): Promise<void> {
  const entriesFile = path.join(config.persistDir, 'entries.json');

  if (fs.existsSync(entriesFile)) {
    try {
      const content = await fsPromises.readFile(entriesFile, 'utf-8');
      entries = JSON.parse(content);
    } catch (err) {
      logger.warn('Failed to load file persistence entries:', err);
      entries = [];
    }
  }
}

/**
 * Save entries to disk
 */
async function saveEntries(): Promise<void> {
  const entriesFile = path.join(config.persistDir, 'entries.json');

  try {
    await fsPromises.writeFile(entriesFile, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save file persistence entries:', err);
  }
}

/**
 * Record a file change
 */
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

  saveEntries().catch((err) => {
    logger.warn('Failed to save file change:', err);
  });

  persistEntry(entry).catch((err) => {
    logger.warn(`Failed to persist entry for ${filePath}:`, err);
  });
}

/**
 * Persist entry to individual file
 */
async function persistEntry(entry: FilePersistenceEntry): Promise<void> {
  const entryFile = path.join(
    config.persistDir,
    `${Buffer.from(entry.path).toString('base64').slice(0, 50)}.json`
  );

  try {
    await fsPromises.writeFile(entryFile, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`Failed to persist entry for ${entry.path}:`, err);
  }
}

/**
 * Get file history for a path
 */
export function getFileHistory(filePath: string): FilePersistenceEntry[] {
  const normalized = path.normalize(filePath);
  return entries.filter((e) => e.path === normalized);
}

/**
 * Get original content from first recorded change
 */
export function getOriginalContent(filePath: string): string | null {
  const history = getFileHistory(filePath);
  if (history.length === 0) {
    return null;
  }
  return history[0].originalContent;
}

/**
 * Get previous version of a file
 */
export function getPreviousVersion(filePath: string, versionIndex: number = -2): string | null {
  const history = getFileHistory(filePath);
  if (history.length < Math.abs(versionIndex) + 1) {
    return null;
  }
  return history[history.length + versionIndex].modifiedContent;
}

/**
 * Revert file to a previous version
 */
export async function revertToVersion(filePath: string, versionIndex: number = -2): Promise<boolean> {
  const content = getPreviousVersion(filePath, versionIndex);
  if (content === null) {
    return false;
  }

  try {
    await fsPromises.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logger.error(`Failed to revert ${filePath}:`, err);
    return false;
  }
}

/**
 * Clear file history
 */
export function clearFileHistory(filePath?: string): void {
  if (filePath) {
    const normalized = path.normalize(filePath);
    entries = entries.filter((e) => e.path !== normalized);
  } else {
    entries = [];
  }
  saveEntries();
}

/**
 * Get all history entries
 */
export function getAllHistory(): FilePersistenceEntry[] {
  return [...entries];
}

/**
 * Get session-specific history
 */
export function getSessionHistory(sessionId: string): FilePersistenceEntry[] {
  return entries.filter((e) => e.sessionId === sessionId);
}

/**
 * Get persistence statistics
 */
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
    if (fs.existsSync(config.persistDir)) {
      const files = fs.readdirSync(config.persistDir);
      for (const file of files) {
        const stat = fs.statSync(path.join(config.persistDir, file));
        diskUsage += stat.size;
      }
    }
  } catch {
    // Ignore errors
  }

  return {
    totalEntries: entries.length,
    uniqueFiles,
    diskUsage,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

/**
 * Enable file persistence
 */
export function enableFilePersistence(): void {
  config.enabled = true;
}

/**
 * Disable file persistence
 */
export function disableFilePersistence(): void {
  config.enabled = false;
}

/**
 * Check if file persistence is enabled
 */
export function isFilePersistenceEnabled(): boolean {
  return config.enabled;
}

/**
 * Find modified files in outputs directory
 */
export async function findModifiedFiles(
  turnStartTime: TurnStartTime,
  outputsDir: string
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  if (!fs.existsSync(outputsDir)) {
    return modifiedFiles;
  }

  try {
    const scanDir = async (dir: string): Promise<void> => {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = await fsPromises.stat(fullPath);
            if (stat.mtimeMs >= turnStartTime) {
              modifiedFiles.push(fullPath);
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    };

    await scanDir(outputsDir);
  } catch (err) {
    logger.error(`Failed to scan outputs directory: ${err}`);
  }

  return modifiedFiles;
}

/**
 * Run file persistence for outputs directory
 */
export async function runFilePersistence(
  turnStartTime: TurnStartTime,
  signal?: AbortSignal
): Promise<FilesPersistedEventData | null> {
  if (!config.enabled) {
    return null;
  }

  const sessionId = process.env.PAKALON_SESSION_ID;
  if (!sessionId) {
    logger.debug('No session ID for file persistence');
    return null;
  }

  const outputsDir = path.join(process.cwd(), sessionId, OUTPUTS_SUBDIR);

  if (signal?.aborted) {
    logger.debug('Persistence aborted before processing');
    return null;
  }

  const startTime = Date.now();

  try {
    const modifiedFiles = await findModifiedFiles(turnStartTime, outputsDir);

    if (modifiedFiles.length === 0) {
      logger.debug('No modified files to persist');
      return { files: [], failed: [] };
    }

    logger.debug(`Found ${modifiedFiles.length} modified files`);

    if (modifiedFiles.length > FILE_COUNT_LIMIT) {
      logger.warn(`File count limit exceeded: ${modifiedFiles.length} > ${FILE_COUNT_LIMIT}`);
      return {
        files: [],
        failed: [
          {
            filename: outputsDir,
            error: `Too many files modified (${modifiedFiles.length}). Maximum: ${FILE_COUNT_LIMIT}.`,
          },
        ],
      };
    }

    const results = await uploadSessionFiles(
      modifiedFiles.map((filePath) => ({
        path: filePath,
        relativePath: path.relative(outputsDir, filePath),
      })),
      { sessionId },
      DEFAULT_UPLOAD_CONCURRENCY
    );

    const persistedFiles: PersistedFile[] = [];
    const failedFiles: FailedPersistence[] = [];

    for (const result of results) {
      if (result.success) {
        persistedFiles.push({
          filename: result.path,
          file_id: result.fileId,
        });
      } else {
        failedFiles.push({
          filename: result.path,
          error: result.error || 'Unknown error',
        });
      }
    }

    const durationMs = Date.now() - startTime;
    logger.debug(
      `File persistence complete: ${persistedFiles.length} uploaded, ${failedFiles.length} failed (${durationMs}ms)`
    );

    return {
      files: persistedFiles,
      failed: failedFiles,
    };
  } catch (error) {
    logger.error(`File persistence failed: ${error}`);
    return {
      files: [],
      failed: [
        {
          filename: outputsDir,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      ],
    };
  }
}

/**
 * Upload session files to storage
 */
async function uploadSessionFiles(
  files: Array<{ path: string; relativePath: string }>,
  _config: { sessionId: string },
  _concurrency: number
): Promise<Array<{ success: boolean; path: string; fileId?: string; error?: string }>> {
  const results: Array<{ success: boolean; path: string; fileId?: string; error?: string }> = [];

  for (const file of files) {
    try {
      const content = await fsPromises.readFile(file.path);

      const fileId = Buffer.from(file.relativePath).toString('base64');

      recordFileChange(file.path, '', content.toString(), _config.sessionId);

      results.push({
        success: true,
        path: file.path,
        fileId,
      });
    } catch (error) {
      results.push({
        success: false,
        path: file.path,
        error: error instanceof Error ? error.message : 'Upload failed',
      });
    }
  }

  return results;
}

/**
 * Check if file persistence is enabled with all requirements
 */
export function isFilePersistenceAvailable(): boolean {
  return (
    config.enabled &&
    !!process.env.PAKALON_SESSION_ID &&
    fs.existsSync(config.persistDir)
  );
}

export default {
  initFilePersistence,
  recordFileChange,
  getFileHistory,
  getOriginalContent,
  getPreviousVersion,
  revertToVersion,
  clearFileHistory,
  getAllHistory,
  getSessionHistory,
  getPersistenceStats,
  enableFilePersistence,
  disableFilePersistence,
  isFilePersistenceEnabled,
  runFilePersistence,
  isFilePersistenceAvailable,
};