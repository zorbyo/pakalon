import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SETTING_SOURCES,
  type SettingSource,
} from './types.js';
import {
  SETTINGS_DIR,
  SETTINGS_FILENAME,
  LOCAL_SETTINGS_FILENAME,
  FILE_STABILITY_THRESHOLD_MS,
  FILE_STABILITY_POLL_INTERVAL_MS,
  INTERNAL_WRITE_WINDOW_MS,
  DELETION_GRACE_MS,
} from './constants.js';
import {
  getSettingsFilePathForSource,
  consumeInternalWrite,
  resetSettingsCache,
  notifyChange,
  type SettingsChange,
} from './settings.js';
import logger from '@/utils/logger.js';

interface PendingDeletion {
  timer: ReturnType<typeof setTimeout>;
  source: SettingSource;
}

let watcher: fs.FSWatcher | null = null;
let initialized = false;
let disposed = false;
let lastMdmSnapshot: string | null = null;
const pendingDeletions = new Map<string, PendingDeletion>();
const settingsChangedCallbacks: Array<(source: SettingSource) => void> = [];

export async function initialize(): Promise<void> {
  if (initialized || disposed) return;
  initialized = true;

  const { dirs, settingsFiles } = await getWatchTargets();
  if (dirs.length === 0) return;

  logger.debug(`Watching for changes in setting files: ${[...settingsFiles].join(', ')}`);

  const debouncedHandlers = new Map<string, ReturnType<typeof setTimeout>>();

  watcher = fs.watch(dirs, { recursive: false }, (eventType, filename) => {
    if (!filename) return;

    const normalized = path.normalize(filename);
    const fullPath = findMatchingSettingsFile(normalized, settingsFiles);
    if (!fullPath) return;

    const existingTimer = debouncedHandlers.get(fullPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      debouncedHandlers.delete(fullPath);
      handleFileChange(fullPath);
    }, FILE_STABILITY_THRESHOLD_MS);

    debouncedHandlers.set(fullPath, timer);
  });
}

function findMatchingSettingsFile(filename: string, settingsFiles: Set<string>): string | undefined {
  for (const sf of settingsFiles) {
    if (sf.endsWith(filename) || filename.endsWith(path.basename(sf))) {
      return sf;
    }
  }
  return undefined;
}

function handleFileChange(filePath: string): void {
  const source = getSourceForPath(filePath);
  if (!source) return;

  if (consumeInternalWrite(filePath, INTERNAL_WRITE_WINDOW_MS)) {
    logger.debug(`Ignoring internal write to ${filePath}`);
    return;
  }

  logger.debug(`Detected change to ${filePath}`);

  cancelPendingDeletion(filePath);

  const change: SettingsChange = {
    key: 'settings',
    oldValue: null,
    newValue: null,
    timestamp: new Date().toISOString(),
    source,
  };

  notifyChange(source, change);

  for (const callback of settingsChangedCallbacks) {
    try {
      callback(source);
    } catch (err) {
      logger.warn('Settings change callback error:', err);
    }
  }
}

function handleFileDelete(filePath: string): void {
  const source = getSourceForPath(filePath);
  if (!source) return;

  logger.debug(`Detected deletion of ${filePath}`);

  if (pendingDeletions.has(filePath)) return;

  const timer = setTimeout(
    (fp, src) => {
      pendingDeletions.delete(fp);
      logger.debug(`Processing deletion of ${fp}`);

      const change: SettingsChange = {
        key: 'settings',
        oldValue: null,
        newValue: null,
        timestamp: new Date().toISOString(),
        source: src,
      };

      notifyChange(src, change);

      for (const callback of settingsChangedCallbacks) {
        try {
          callback(src);
        } catch (err) {
          logger.warn('Settings change callback error:', err);
        }
      }
    },
    DELETION_GRACE_MS,
    filePath,
    source,
  );

  pendingDeletions.set(filePath, { timer, source });
}

function handleFileAdd(filePath: string): void {
  const source = getSourceForPath(filePath);
  if (!source) return;

  logger.debug(`Detected addition of ${filePath}`);
  cancelPendingDeletion(filePath);
  handleFileChange(filePath);
}

function cancelPendingDeletion(filePath: string): void {
  const pending = pendingDeletions.get(filePath);
  if (pending) {
    clearTimeout(pending.timer);
    pendingDeletions.delete(filePath);
    logger.debug(`Cancelled pending deletion of ${filePath}`);
  }
}

async function getWatchTargets(): Promise<{ dirs: string[]; settingsFiles: Set<string> }> {
  const settingsFiles = new Set<string>();
  const dirsWithFiles = new Set<string>();

  for (const source of SETTING_SOURCES) {
    if (source === 'flagSettings') continue;

    const filePath = getSettingsFilePathForSource(source);
    if (!filePath) continue;

    settingsFiles.add(filePath);

    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.isFile()) {
        dirsWithFiles.add(path.dirname(filePath));
      }
    } catch {
      // File doesn't exist yet, but we still want to watch the directory
      dirsWithFiles.add(path.dirname(filePath));
    }
  }

  return {
    dirs: [...dirsWithFiles],
    settingsFiles,
  };
}

function getSourceForPath(filePath: string): SettingSource | undefined {
  const normalized = path.normalize(filePath);

  return SETTING_SOURCES.find(source => {
    const sourcePath = getSettingsFilePathForSource(source);
    return sourcePath && path.normalize(sourcePath) === normalized;
  });
}

export function dispose(): void {
  disposed = true;

  for (const pending of pendingDeletions.values()) {
    clearTimeout(pending.timer);
  }
  pendingDeletions.clear();

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  settingsChangedCallbacks.length = 0;
}

export function subscribe(callback: (source: SettingSource) => void): () => void {
  settingsChangedCallbacks.push(callback);
  return () => {
    const index = settingsChangedCallbacks.indexOf(callback);
    if (index > -1) {
      settingsChangedCallbacks.splice(index, 1);
    }
  };
}

export function notifySettingsChange(source: SettingSource): void {
  logger.debug(`Programmatic settings change notification for ${source}`);
  notifyChange(source);
  resetSettingsCache();

  for (const callback of settingsChangedCallbacks) {
    try {
      callback(source);
    } catch (err) {
      logger.warn('Settings change callback error:', err);
    }
  }
}

export function resetForTesting(): void {
  dispose();
  initialized = false;
  disposed = false;
  lastMdmSnapshot = null;
}

export const settingsChangeDetector = {
  initialize,
  dispose,
  subscribe,
  notifyChange: notifySettingsChange,
  resetForTesting,
};