import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  SETTINGS_DIR,
  SETTINGS_FILENAME,
  LOCAL_SETTINGS_FILENAME,
  SETTINGS_SYNC_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  MAX_FILE_SIZE_BYTES,
  SYNC_KEYS,
} from './constants.js';
import {
  type SettingsJson,
  type SettingsChange,
  getSettingsFilePathForSource,
  getInitialSettings,
  resetSettingsCache,
  notifyChange,
  markInternalWrite,
} from './settings.js';
import logger from '@/utils/logger.js';

export interface RemoteSettingsConfig {
  endpoint?: string;
  apiKey?: string;
  syncInterval?: number;
  enabled?: boolean;
  lastSyncAt?: string;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  checksum?: string;
  lastModified?: string;
}

export interface FetchResult {
  success: boolean;
  data?: UserSyncData;
  isEmpty?: boolean;
  error?: string;
  skipRetry?: boolean;
}

export interface UserSyncContent {
  entries: Record<string, string>;
}

export interface UserSyncData {
  userId: string;
  version: number;
  lastModified: string;
  checksum: string;
  content: UserSyncContent;
}

let remoteSettingsConfig: RemoteSettingsConfig | null = null;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let downloadPromise: Promise<boolean> | null = null;

export function getRemoteSettingsConfig(): RemoteSettingsConfig {
  if (remoteSettingsConfig) return remoteSettingsConfig;

  const configPath = path.join(os.homedir(), SETTINGS_DIR, 'remote.json');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      remoteSettingsConfig = JSON.parse(content);
      return remoteSettingsConfig!;
    }
  } catch (err) {
    logger.warn('Failed to load remote settings config:', err);
  }

  remoteSettingsConfig = { enabled: false };
  return remoteSettingsConfig;
}

export async function saveRemoteSettingsConfig(config: RemoteSettingsConfig): Promise<void> {
  const configPath = path.join(os.homedir(), SETTINGS_DIR, 'remote.json');

  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    remoteSettingsConfig = config;
  } catch (err) {
    logger.error('Failed to save remote settings config:', err);
    throw err;
  }
}

export function isRemoteSyncEnabled(): boolean {
  const config = getRemoteSettingsConfig();
  return config.enabled === true && !!config.endpoint;
}

async function getAuthHeaders(): Promise<{ headers: Record<string, string>; error?: string }> {
  const config = getRemoteSettingsConfig();

  if (!config.apiKey) {
    return { headers: {}, error: 'No API key available' };
  }

  return {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

function getSyncEndpoint(): string {
  const config = getRemoteSettingsConfig();
  return `${config.endpoint}/api/settings`;
}

async function fetchRemoteSettingsOnce(maxRetries = DEFAULT_MAX_RETRIES): Promise<FetchResult> {
  const config = getRemoteSettingsConfig();

  if (!config.enabled || !config.endpoint) {
    return { success: false, error: 'Remote sync is not enabled', skipRetry: true };
  }

  try {
    const authHeaders = await getAuthHeaders();
    if (authHeaders.error) {
      return { success: false, error: authHeaders.error, skipRetry: true };
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': 'pakalon-cli',
    };

    const endpoint = getSyncEndpoint();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SETTINGS_SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        logger.debug('No remote settings found');
        return { success: true, isEmpty: true };
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}`, skipRetry: response.status === 401 };
      }

      const data = await response.json() as UserSyncData;
      return { success: true, data, isEmpty: false };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Request timeout', skipRetry: false };
    }
    logger.error('Failed to fetch remote settings:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function fetchRemoteSettings(maxRetries = DEFAULT_MAX_RETRIES): Promise<FetchResult> {
  let lastResult: FetchResult | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    lastResult = await fetchRemoteSettingsOnce(maxRetries);

    if (lastResult.success) return lastResult;
    if (lastResult.skipRetry) return lastResult;
    if (attempt > maxRetries) return lastResult;

    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    logger.debug(`Retrying remote settings fetch in ${delayMs}ms (attempt ${attempt})`);
    await sleep(delayMs);
  }

  return lastResult!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadSettings(entries: Record<string, string>): Promise<SyncResult> {
  const config = getRemoteSettingsConfig();

  if (!config.enabled || !config.endpoint) {
    return { success: false, error: 'Remote sync is not enabled' };
  }

  try {
    const authHeaders = await getAuthHeaders();
    if (authHeaders.error) {
      return { success: false, error: authHeaders.error };
    }

    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'Content-Type': 'application/json',
    };

    const endpoint = getSyncEndpoint();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SETTINGS_SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ entries }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        checksum: data.checksum,
        lastModified: data.lastModified,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  } catch (err) {
    logger.error('Failed to upload settings:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function uploadUserSettingsInBackground(): Promise<void> {
  if (!isRemoteSyncEnabled()) {
    logger.debug('Remote sync is not enabled, skipping upload');
    return;
  }

  try {
    const entries = await buildEntriesFromLocalFiles();
    const changedEntries = await getChangedEntries(entries);

    if (Object.keys(changedEntries).length === 0) {
      logger.debug('No settings changes to upload');
      return;
    }

    const result = await uploadSettings(changedEntries);
    if (result.success) {
      logger.info(`Uploaded ${Object.keys(changedEntries).length} settings entries`);
    } else {
      logger.warn(`Failed to upload settings: ${result.error}`);
    }
  } catch (err) {
    logger.error('Unexpected error during settings upload:', err);
  }
}

export function downloadUserSettings(): Promise<boolean> {
  if (downloadPromise) {
    return downloadPromise;
  }
  downloadPromise = doDownloadUserSettings();
  return downloadPromise;
}

export async function doDownloadUserSettings(maxRetries = DEFAULT_MAX_RETRIES): Promise<boolean> {
  if (!isRemoteSyncEnabled()) {
    logger.debug('Remote sync is not enabled, skipping download');
    return false;
  }

  try {
    const result = await fetchRemoteSettings(maxRetries);

    if (!result.success) {
      logger.warn(`Failed to fetch remote settings: ${result.error}`);
      return false;
    }

    if (result.isEmpty) {
      logger.debug('No remote settings to download');
      return false;
    }

    const entries = result.data!.content.entries;
    await applyRemoteEntriesToLocal(entries);

    const config = getRemoteSettingsConfig();
    config.lastSyncAt = new Date().toISOString();
    await saveRemoteSettingsConfig(config);

    logger.info(`Downloaded and applied ${Object.keys(entries).length} settings entries`);
    return true;
  } catch (err) {
    logger.error('Unexpected error during settings download:', err);
    return false;
  }
}

export async function syncRemoteSettings(): Promise<boolean> {
  const result = await downloadUserSettings();
  if (result) {
    await uploadUserSettingsInBackground();
  }
  return result;
}

export function startBackgroundSync(): void {
  if (syncIntervalId !== null) return;

  const config = getRemoteSettingsConfig();
  const intervalMs = config.syncInterval || 60 * 60 * 1000;

  syncIntervalId = setInterval(() => {
    void syncRemoteSettings();
  }, intervalMs);

  logger.debug(`Started background sync with interval ${intervalMs}ms`);
}

export function stopBackgroundSync(): void {
  if (syncIntervalId !== null) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.debug('Stopped background sync');
  }
}

async function tryReadFileForSync(filePath: string): Promise<string | null> {
  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      logger.warn(`File ${filePath} exceeds size limit`);
      return null;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    if (!content || /^\s*$/.test(content)) {
      return null;
    }

    return content;
  } catch {
    return null;
  }
}

async function buildEntriesFromLocalFiles(): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};

  const userSettingsPath = getSettingsFilePathForSource('userSettings');
  if (userSettingsPath) {
    const content = await tryReadFileForSync(userSettingsPath);
    if (content) {
      entries[SYNC_KEYS.USER_SETTINGS] = content;
    }
  }

  const localSettingsPath = getSettingsFilePathForSource('localSettings');
  if (localSettingsPath) {
    const content = await tryReadFileForSync(localSettingsPath);
    if (content) {
      entries[SYNC_KEYS.projectSettings('default')] = content;
    }
  }

  return entries;
}

async function getChangedEntries(localEntries: Record<string, string>): Promise<Record<string, string>> {
  const changed: Record<string, string> = {};

  try {
    const result = await fetchRemoteSettings(0);
    const remoteEntries = result.isEmpty ? {} : (result.data?.content.entries || {});

    for (const [key, value] of Object.entries(localEntries)) {
      if (remoteEntries[key] !== value) {
        changed[key] = value;
      }
    }
  } catch {
    return localEntries;
  }

  return changed;
}

async function applyRemoteEntriesToLocal(entries: Record<string, string>): Promise<void> {
  let appliedCount = 0;

  const userSettingsContent = entries[SYNC_KEYS.USER_SETTINGS];
  if (userSettingsContent) {
    const userSettingsPath = getSettingsFilePathForSource('userSettings');
    if (userSettingsPath) {
      markInternalWrite(userSettingsPath);
      await writeFileForSync(userSettingsPath, userSettingsContent);
      appliedCount++;
    }
  }

  const localSettingsContent = entries[SYNC_KEYS.projectSettings('default')];
  if (localSettingsContent) {
    const localSettingsPath = getSettingsFilePathForSource('localSettings');
    if (localSettingsPath) {
      markInternalWrite(localSettingsPath);
      await writeFileForSync(localSettingsPath, localSettingsContent);
      appliedCount++;
    }
  }

  if (appliedCount > 0) {
    resetSettingsCache();
    notifyChange('userSettings');
    notifyChange('localSettings');
  }

  logger.debug(`Applied ${appliedCount} remote settings entries`);
}

async function writeFileForSync(filePath: string, content: string): Promise<boolean> {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logger.error(`Failed to write file ${filePath}:`, err);
    return false;
  }
}

export function resetDownloadPromise(): void {
  downloadPromise = null;
}