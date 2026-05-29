import fs from 'fs';
import os from 'os';
import path from 'path';
import { getApiClient } from '@/api/client.js';
import logger from '@/utils/logger.js';
import { loadCredentials } from '@/auth/storage.js';
import { getInitialSettings, getSettingsFilePathForSource, resetSettingsCache, updateSettingsForSource } from './settings.js';

export interface SyncableSettings {
  version: number;
  selectedModel?: string;
  theme?: string;
  permissionMode?: string;
  alwaysAllowRules?: Record<string, string[]>;
  agentConfigs?: Record<string, any>;
  lastModified: number;
}

export interface SyncResult {
  success: boolean;
  direction: 'uploaded' | 'downloaded' | 'no-change' | 'conflict';
  localVersion?: number;
  remoteVersion?: number;
  merged?: SyncableSettings;
}

interface SyncState {
  lastSyncAt?: string;
  lastSuccessfulDirection?: SyncResult['direction'];
}

interface RemoteSyncResponse {
  settings?: unknown;
  data?: unknown;
  remote?: unknown;
  version?: number;
  lastModified?: number;
  conflict?: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'pakalon');
const STATE_PATH = path.join(CONFIG_DIR, 'settings-sync-state.json');
const SYNC_ENDPOINT = '/settings/sync';
const DEFAULT_SYNC_INTERVAL_MS = 30 * 60 * 1000;

let cachedState: SyncState | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight: Promise<SyncResult | null> | null = null;

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function loadState(): SyncState {
  if (cachedState) return cachedState;
  cachedState = readJsonFile<SyncState>(STATE_PATH) ?? {};
  return cachedState;
}

function saveState(next: SyncState): void {
  cachedState = next;
  writeJsonFile(STATE_PATH, next);
}

function stripSyncableSettings(input: Partial<SyncableSettings> | undefined): SyncableSettings {
  return {
    version: Number(input?.version ?? 1),
    selectedModel: input?.selectedModel,
    theme: input?.theme,
    permissionMode: input?.permissionMode,
    alwaysAllowRules: input?.alwaysAllowRules,
    agentConfigs: input?.agentConfigs,
    lastModified: Number(input?.lastModified ?? Date.now()),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeObjects(base: Record<string, any>, overlay: Record<string, any>): Record<string, any> {
  const merged: Record<string, any> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      merged[key] = [...value];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeObjects(merged[key], value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

function pickSyncableSettings(source: Record<string, any>): SyncableSettings {
  return stripSyncableSettings({
    version: source.version,
    selectedModel: source.selectedModel ?? source.model,
    theme: source.theme,
    permissionMode: source.permissionMode,
    alwaysAllowRules: source.alwaysAllowRules,
    agentConfigs: source.agentConfigs,
    lastModified: source.lastModified,
  });
}

function extractSyncableSettings(payload: unknown): SyncableSettings | null {
  if (!isPlainObject(payload)) return null;

  const candidate =
    (isPlainObject(payload.settings) && payload.settings)
    || (isPlainObject(payload.data) && payload.data)
    || (isPlainObject(payload.remote) && payload.remote)
    || payload;

  if (!isPlainObject(candidate)) return null;
  return pickSyncableSettings(candidate);
}

function getLocalUserSettingsMtime(): number {
  try {
    const filePath = getSettingsFilePathForSource('userSettings');
    if (filePath && fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtimeMs;
    }
  } catch {
    // ignore
  }
  return Date.now();
}

function getCurrentLocalSyncableSettings(): SyncableSettings {
  const settings = getInitialSettings();
  return stripSyncableSettings({
    version: Number((settings as Record<string, any>).version ?? 1),
    selectedModel: (settings as Record<string, any>).selectedModel ?? (settings as Record<string, any>).model,
    theme: (settings as Record<string, any>).theme as string | undefined,
    permissionMode: (settings as Record<string, any>).permissionMode as string | undefined,
    alwaysAllowRules: (settings as Record<string, any>).alwaysAllowRules as Record<string, string[]> | undefined,
    agentConfigs: (settings as Record<string, any>).agentConfigs as Record<string, any> | undefined,
    lastModified: getLocalUserSettingsMtime(),
  });
}

function isOfflineError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Could not connect to the Pakalon backend|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(message);
}

function isAuthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Authentication failed|Access denied|Unauthorized|Forbidden/i.test(message);
}

function updateLastSyncTime(direction: SyncResult['direction']): void {
  const next = loadState();
  saveState({ ...next, lastSyncAt: new Date().toISOString(), lastSuccessfulDirection: direction });
}

function saveLocalSyncableSettings(settings: SyncableSettings): void {
  const current = getInitialSettings();
  const next = mergeObjects(current as Record<string, any>, {
    selectedModel: settings.selectedModel,
    theme: settings.theme,
    permissionMode: settings.permissionMode,
    alwaysAllowRules: settings.alwaysAllowRules,
    agentConfigs: settings.agentConfigs,
    version: settings.version,
    lastModified: settings.lastModified,
  });

  const result = updateSettingsForSource('userSettings', next as any);
  if (result.error) {
    throw result.error;
  }
  resetSettingsCache();
}

async function readRemoteSettings(): Promise<SyncableSettings | null> {
  try {
    const response = await getApiClient().get<RemoteSyncResponse>(SYNC_ENDPOINT);
    return extractSyncableSettings(response.data);
  } catch (err) {
    if (isOfflineError(err) || isAuthError(err)) return null;
    logger.warn('[settings-sync] Failed to read remote settings', { error: String(err) });
    return null;
  }
}

function buildUploadPayload(local: SyncableSettings): SyncableSettings {
  return stripSyncableSettings({
    ...local,
    version: Number(local.version || 1) + 1,
    lastModified: Date.now(),
  });
}

function resolveComparison(local: SyncableSettings, remote: SyncableSettings): 'local' | 'remote' | 'equal' {
  if (local.lastModified > remote.lastModified) return 'local';
  if (remote.lastModified > local.lastModified) return 'remote';
  if (local.version > remote.version) return 'local';
  if (remote.version > local.version) return 'remote';
  return 'equal';
}

export function resolveConflict(local: SyncableSettings, remote: SyncableSettings): SyncableSettings {
  const winner = resolveComparison(local, remote);

  if (winner === 'local') {
    return mergeObjects(remote as Record<string, any>, local as Record<string, any>) as SyncableSettings;
  }

  if (winner === 'remote') {
    return mergeObjects(local as Record<string, any>, remote as Record<string, any>) as SyncableSettings;
  }

  return mergeObjects(local as Record<string, any>, remote as Record<string, any>) as SyncableSettings;
}

export function isSyncEnabled(): boolean {
  if (process.env.PAKALON_DISABLE_SETTINGS_SYNC === '1') return false;
  if (process.env.PAKALON_SETTINGS_SYNC === '0') return false;
  return !!loadCredentials()?.token;
}

export function getLastSyncTime(): Date | null {
  const state = loadState();
  return state.lastSyncAt ? new Date(state.lastSyncAt) : null;
}

export async function pushSettingsToCloud(settings: Partial<SyncableSettings>): Promise<SyncResult> {
  if (!isSyncEnabled()) {
    return { success: false, direction: 'no-change' };
  }

  const local = buildUploadPayload(mergeObjects(getCurrentLocalSyncableSettings() as Record<string, any>, stripSyncableSettings(settings) as Record<string, any>) as SyncableSettings);

  try {
    const response = await getApiClient().post<RemoteSyncResponse>(SYNC_ENDPOINT, { settings: local });
    const remote = extractSyncableSettings(response.data);

    if (remote) {
      const merged = resolveConflict(local, remote);
      if (merged.lastModified !== local.lastModified || merged.version !== local.version) {
        saveLocalSyncableSettings(merged);
        updateLastSyncTime('conflict');
        return {
          success: true,
          direction: 'conflict',
          localVersion: local.version,
          remoteVersion: remote.version,
          merged,
        };
      }
    }

    updateLastSyncTime('uploaded');
    return {
      success: true,
      direction: 'uploaded',
      localVersion: local.version,
      remoteVersion: remote?.version,
      merged: remote ? resolveConflict(local, remote) : local,
    };
  } catch (err) {
    if (isOfflineError(err)) {
      logger.debug('[settings-sync] Offline, skipping upload');
      return { success: false, direction: 'no-change', localVersion: local.version };
    }
    if (isAuthError(err)) {
      logger.warn('[settings-sync] Authentication failed during upload');
      return { success: false, direction: 'no-change', localVersion: local.version };
    }

    logger.warn('[settings-sync] Upload failed', { error: String(err) });
    return { success: false, direction: 'no-change', localVersion: local.version };
  }
}

export async function pullSettingsFromCloud(): Promise<SyncResult | null> {
  if (!isSyncEnabled()) return null;

  const local = getCurrentLocalSyncableSettings();
  const remote = await readRemoteSettings();
  if (!remote) return null;

  const comparison = resolveComparison(local, remote);
  if (comparison === 'equal') {
    const merged = resolveConflict(local, remote);
    if (merged.version !== local.version || merged.lastModified !== local.lastModified) {
      saveLocalSyncableSettings(merged);
      updateLastSyncTime('conflict');
      return {
        success: true,
        direction: 'conflict',
        localVersion: local.version,
        remoteVersion: remote.version,
        merged,
      };
    }

    updateLastSyncTime('no-change');
    return {
      success: true,
      direction: 'no-change',
      localVersion: local.version,
      remoteVersion: remote.version,
      merged: local,
    };
  }

  if (comparison === 'remote') {
    const merged = resolveConflict(local, remote);
    saveLocalSyncableSettings(merged);
    updateLastSyncTime('downloaded');
    return {
      success: true,
      direction: 'downloaded',
      localVersion: local.version,
      remoteVersion: remote.version,
      merged,
    };
  }

  return {
    success: true,
    direction: 'no-change',
    localVersion: local.version,
    remoteVersion: remote.version,
    merged: local,
  };
}

async function syncOnce(): Promise<SyncResult | null> {
  const remote = await readRemoteSettings();
  if (!remote) return null;

  const local = getCurrentLocalSyncableSettings();
  const comparison = resolveComparison(local, remote);

  if (comparison === 'remote') {
    const merged = resolveConflict(local, remote);
    saveLocalSyncableSettings(merged);
    updateLastSyncTime('downloaded');
    return {
      success: true,
      direction: 'downloaded',
      localVersion: local.version,
      remoteVersion: remote.version,
      merged,
    };
  }

  if (comparison === 'local') {
    return pushSettingsToCloud(local);
  }

  const merged = resolveConflict(local, remote);
  if (merged.version !== local.version || merged.lastModified !== local.lastModified) {
    saveLocalSyncableSettings(merged);
    updateLastSyncTime('conflict');
    return {
      success: true,
      direction: 'conflict',
      localVersion: local.version,
      remoteVersion: remote.version,
      merged,
    };
  }

  updateLastSyncTime('no-change');
  return {
    success: true,
    direction: 'no-change',
    localVersion: local.version,
    remoteVersion: remote.version,
    merged: local,
  };
}

export function autoSync(intervalMs: number = DEFAULT_SYNC_INTERVAL_MS): { start: () => void; stop: () => void } {
  const start = (): void => {
    if (syncTimer) return;
    void (syncInFlight ??= syncOnce().finally(() => {
      syncInFlight = null;
    }));
    syncTimer = setInterval(() => {
      if (syncInFlight) return;
      syncInFlight = syncOnce().finally(() => {
        syncInFlight = null;
      });
    }, intervalMs);
  };

  const stop = (): void => {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  };

  return { start, stop };
}
