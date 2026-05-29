import fs from 'fs';
import os from 'os';
import path from 'path';
import { getApiClient } from '@/api/client.js';
import logger from '@/utils/logger.js';
import { getInitialSettings } from '../settings.js';

export interface RemoteManagedSettingValue {
  value: unknown;
  locked?: boolean;
  enforced?: boolean;
}

export interface RemoteManagedSettingsCache {
  overrides: Record<string, any>;
  fetchedAt?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'pakalon');
const CACHE_PATH = path.join(CONFIG_DIR, 'remote-managed-settings-cache.json');
const MANAGED_ENDPOINT = '/settings/managed';

let cached: RemoteManagedSettingsCache = { overrides: {} };

function readCacheFromDisk(): RemoteManagedSettingsCache {
  try {
    if (!fs.existsSync(CACHE_PATH)) return { overrides: {} };
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as RemoteManagedSettingsCache;
  } catch {
    return { overrides: {} };
  }
}

function saveCache(next: RemoteManagedSettingsCache): void {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(next, null, 2), 'utf-8');
  cached = next;
}

function getCached(): RemoteManagedSettingsCache {
  if (cached.overrides && Object.keys(cached.overrides).length > 0) return cached;
  cached = readCacheFromDisk();
  return cached;
}

function normalizeOverrides(payload: unknown): Record<string, any> {
  if (!payload || typeof payload !== 'object') return {};
  const data = payload as Record<string, any>;

  if (data.overrides && typeof data.overrides === 'object') return data.overrides as Record<string, any>;
  if (data.settings && typeof data.settings === 'object') return data.settings as Record<string, any>;
  if (data.data && typeof data.data === 'object') return data.data as Record<string, any>;

  return data;
}

function isManagedValue(value: unknown): boolean {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as RemoteManagedSettingValue;
    return item.locked === true || item.enforced === true || Object.prototype.hasOwnProperty.call(item, 'value');
  }
  return true;
}

function extractValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as RemoteManagedSettingValue;
    if (Object.prototype.hasOwnProperty.call(item, 'value')) return item.value;
  }
  return value;
}

function mergeRemoteOverrides(localSettings: any, remoteOverrides: any): any {
  if (!remoteOverrides || typeof remoteOverrides !== 'object') return localSettings;
  if (!localSettings || typeof localSettings !== 'object') return localSettings;

  const next = Array.isArray(localSettings) ? [...localSettings] : { ...localSettings };

  for (const [key, rawValue] of Object.entries(remoteOverrides)) {
    const value = extractValue(rawValue);
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof next[key] === 'object' && next[key] !== null && !Array.isArray(next[key])) {
      next[key] = mergeRemoteOverrides(next[key], value);
      continue;
    }
    next[key] = value;
  }

  return next;
}

export async function fetchRemoteOverrides(): Promise<Record<string, any>> {
  try {
    const response = await getApiClient().get(MANAGED_ENDPOINT);
    const overrides = normalizeOverrides(response.data);
    saveCache({ overrides, fetchedAt: new Date().toISOString() });
    return overrides;
  } catch (err) {
    logger.debug('[remote-managed-settings] using cached overrides', { error: String(err) });
    return getCached().overrides;
  }
}

export function isSettingManagedRemotely(key: string): boolean {
  const overrides = getCached().overrides;
  return Object.prototype.hasOwnProperty.call(overrides, key) && isManagedValue(overrides[key]);
}

export function applyRemoteOverrides(localSettings: any, remoteOverrides: any): any {
  return mergeRemoteOverrides(localSettings, remoteOverrides);
}

export async function getManagedSettings(): Promise<any> {
  const localSettings = getInitialSettings();
  const remoteOverrides = await fetchRemoteOverrides();
  const merged = applyRemoteOverrides(localSettings, remoteOverrides);

  return {
    settings: merged,
    overrides: remoteOverrides,
    fetchedAt: getCached().fetchedAt ?? null,
  };
}
