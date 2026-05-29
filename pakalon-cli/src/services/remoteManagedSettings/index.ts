/**
 * Remote Managed Settings Service
 *
 * Fetches and applies settings managed remotely from the Pakalon backend.
 * Supports caching, ETag-based conditional requests, and offline fallback.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "@/utils/logger.js";

export interface RemoteSetting {
  key: string;
  value: unknown;
  enforced: boolean;
  scope: "global" | "organization" | "team" | "user";
  updatedAt: string;
}

export interface RemoteManagedSettings {
  settings: RemoteSetting[];
  version: string;
  organizationId?: string;
  teamId?: string;
  fetchedAt: string;
  etag?: string;
}

export interface RemoteSettingsConfig {
  apiUrl?: string;
  authToken?: string;
  cacheTtlMs?: number;
  offlineFallback?: boolean;
}

export interface RemoteSettingsStatus {
  isConnected: boolean;
  lastFetch: string | null;
  version: string | null;
  settingCount: number;
  error: string | null;
}

const REMOTE_CACHE_PATH = path.join(
  os.homedir(),
  ".config",
  "pakalon",
  "remote-settings.json",
);

const DEFAULT_CONFIG: Required<RemoteSettingsConfig> = {
  apiUrl: process.env.PAKALON_API_URL ?? "https://api.pakalon.com",
  authToken: process.env.PAKALON_TOKEN ?? "",
  cacheTtlMs: 5 * 60 * 1000,
  offlineFallback: true,
};

let cachedSettings: RemoteManagedSettings | null = null;
let cacheTimestamp = 0;
let lastError: string | null = null;
let isConnected = false;

function loadCachedSettings(): RemoteManagedSettings | null {
  try {
    if (fs.existsSync(REMOTE_CACHE_PATH)) {
      const raw = fs.readFileSync(REMOTE_CACHE_PATH, "utf-8");
      return JSON.parse(raw) as RemoteManagedSettings;
    }
  } catch {
    // Cache corrupted
  }
  return null;
}

function saveCachedSettings(settings: RemoteManagedSettings): void {
  try {
    const dir = path.dirname(REMOTE_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(REMOTE_CACHE_PATH, JSON.stringify(settings, null, 2));
  } catch {
    // Best effort
  }
}

function isCacheValid(config: Required<RemoteSettingsConfig>): boolean {
  return cachedSettings !== null &&
    Date.now() - cacheTimestamp < config.cacheTtlMs;
}

async function fetchRemoteSettings(
  config: Required<RemoteSettingsConfig>,
): Promise<RemoteManagedSettings | null> {
  if (!config.authToken) {
    logger.debug("[remoteSettings] no auth token, skipping remote fetch");
    return null;
  }

  try {
    const url = `${config.apiUrl}/api/v1/settings/managed`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${config.authToken}`,
      "Content-Type": "application/json",
    };

    if (cachedSettings?.etag) {
      headers["If-None-Match"] = cachedSettings.etag;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 304) {
      logger.debug("[remoteSettings] not modified, using cache");
      return cachedSettings;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const etag = response.headers.get("etag") ?? undefined;
    const data = await response.json() as {
      settings: RemoteSetting[];
      version: string;
      organizationId?: string;
      teamId?: string;
    };

    const result: RemoteManagedSettings = {
      settings: data.settings,
      version: data.version,
      organizationId: data.organizationId,
      teamId: data.teamId,
      fetchedAt: new Date().toISOString(),
      etag,
    };

    isConnected = true;
    return result;
  } catch (err) {
    isConnected = false;
    lastError = err instanceof Error ? err.message : String(err);
    logger.warn("[remoteSettings] fetch failed", { error: lastError });
    return null;
  }
}

export async function loadRemoteSettings(
  config?: RemoteSettingsConfig,
): Promise<RemoteManagedSettings | null> {
  const resolved = { ...DEFAULT_CONFIG, ...config };

  if (isCacheValid(resolved) && cachedSettings) {
    return cachedSettings;
  }

  const remote = await fetchRemoteSettings(resolved);

  if (remote) {
    cachedSettings = remote;
    cacheTimestamp = Date.now();
    saveCachedSettings(remote);
    lastError = null;
    return remote;
  }

  if (resolved.offlineFallback) {
    const cached = loadCachedSettings();
    if (cached) {
      cachedSettings = cached;
      cacheTimestamp = Date.now();
      logger.info("[remoteSettings] using cached settings (offline)");
      return cached;
    }
  }

  return null;
}

export function getRemoteSetting<T>(key: string, defaultValue?: T): T | undefined {
  if (!cachedSettings) return defaultValue;

  const setting = cachedSettings.settings.find((s) => s.key === key);
  if (!setting) return defaultValue;

  return setting.value as T;
}

export function getEnforcedRemoteSettings(): RemoteSetting[] {
  if (!cachedSettings) return [];
  return cachedSettings.settings.filter((s) => s.enforced);
}

export function isRemoteSettingEnforced(key: string): boolean {
  if (!cachedSettings) return false;
  const setting = cachedSettings.settings.find((s) => s.key === key);
  return setting?.enforced ?? false;
}

export function getRemoteSettingsStatus(): RemoteSettingsStatus {
  return {
    isConnected,
    lastFetch: cachedSettings?.fetchedAt ?? null,
    version: cachedSettings?.version ?? null,
    settingCount: cachedSettings?.settings.length ?? 0,
    error: lastError,
  };
}

export function clearRemoteSettingsCache(): void {
  cachedSettings = null;
  cacheTimestamp = 0;
  try {
    if (fs.existsSync(REMOTE_CACHE_PATH)) {
      fs.unlinkSync(REMOTE_CACHE_PATH);
    }
  } catch {
    // Best effort
  }
  logger.info("[remoteSettings] cache cleared");
}

export async function refreshRemoteSettings(
  config?: RemoteSettingsConfig,
): Promise<RemoteManagedSettings | null> {
  cacheTimestamp = 0;
  return loadRemoteSettings(config);
}
