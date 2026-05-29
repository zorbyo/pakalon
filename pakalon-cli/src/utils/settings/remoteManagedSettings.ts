/**
 * Remote Managed Settings — enterprise settings managed by remote admin.
 * Matches Claude's remoteManagedSettings system for enterprise deployments.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "@/utils/logger.js";

export interface RemoteManagedSetting {
  key: string;
  value: unknown;
  source: "admin" | "mdm" | "policy";
  locked: boolean;
  description?: string;
  enforcedAt?: string;
}

export interface RemoteManagedSettings {
  settings: Map<string, RemoteManagedSetting>;
  lastSyncedAt?: string;
  syncUrl?: string;
}

const SETTINGS_PATH = path.join(os.homedir(), ".config", "pakalon", "remote-managed-settings.json");

let cachedSettings: RemoteManagedSettings = {
  settings: new Map(),
};

function loadSettings(): void {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const data = JSON.parse(raw) as { settings: [string, RemoteManagedSetting][]; lastSyncedAt?: string; syncUrl?: string };
      cachedSettings = {
        settings: new Map(data.settings),
        lastSyncedAt: data.lastSyncedAt,
        syncUrl: data.syncUrl,
      };
    }
  } catch (err) {
    logger.warn("[remote-settings] Failed to load", { error: String(err) });
  }
}

function saveSettings(): void {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      settings: Array.from(cachedSettings.settings.entries()),
      lastSyncedAt: cachedSettings.lastSyncedAt,
      syncUrl: cachedSettings.syncUrl,
    };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.warn("[remote-settings] Failed to save", { error: String(err) });
  }
}

loadSettings();

export function getSetting(key: string): RemoteManagedSetting | undefined {
  return cachedSettings.settings.get(key);
}

export function getSettingValue<T>(key: string, defaultValue: T): T {
  const setting = cachedSettings.settings.get(key);
  if (!setting) return defaultValue;
  return setting.value as T;
}

export function setSetting(key: string, value: unknown, options?: { source?: string; locked?: boolean; description?: string }): void {
  const existing = cachedSettings.settings.get(key);
  if (existing?.locked && options?.source !== "admin") {
    logger.warn("[remote-settings] Cannot override locked setting", { key });
    return;
  }

  cachedSettings.settings.set(key, {
    key,
    value,
    source: (options?.source as RemoteManagedSetting["source"]) ?? "admin",
    locked: options?.locked ?? false,
    description: options?.description,
    enforcedAt: new Date().toISOString(),
  });
  saveSettings();
  logger.debug("[remote-settings] Set", { key, locked: options?.locked });
}

export function removeSetting(key: string): boolean {
  const setting = cachedSettings.settings.get(key);
  if (setting?.locked) {
    logger.warn("[remote-settings] Cannot remove locked setting", { key });
    return false;
  }
  const deleted = cachedSettings.settings.delete(key);
  if (deleted) saveSettings();
  return deleted;
}

export function getAllSettings(): RemoteManagedSetting[] {
  return Array.from(cachedSettings.settings.values());
}

export function getLockedSettings(): RemoteManagedSetting[] {
  return Array.from(cachedSettings.settings.values()).filter((s) => s.locked);
}

export function isSettingLocked(key: string): boolean {
  return cachedSettings.settings.get(key)?.locked ?? false;
}

export function canModifySetting(key: string): boolean {
  const setting = cachedSettings.settings.get(key);
  return !setting || !setting.locked;
}

export function syncFromRemote(url: string, authToken: string): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn("[remote-settings] Sync failed", { status: response.status });
        resolve(false);
        return;
      }

      const data = await response.json() as Record<string, unknown>;
      for (const [key, value] of Object.entries(data)) {
        setSetting(key, value, { source: "admin", locked: true });
      }

      cachedSettings.lastSyncedAt = new Date().toISOString();
      cachedSettings.syncUrl = url;
      saveSettings();

      logger.info("[remote-settings] Synced", { count: Object.keys(data).length });
      resolve(true);
    } catch (err) {
      logger.warn("[remote-settings] Sync error", { error: String(err) });
      resolve(false);
    }
  });
}

export function getLastSyncedAt(): string | undefined {
  return cachedSettings.lastSyncedAt;
}

export function clearRemoteSettings(): void {
  cachedSettings.settings.clear();
  cachedSettings.lastSyncedAt = undefined;
  cachedSettings.syncUrl = undefined;
  saveSettings();
  logger.info("[remote-settings] Cleared all remote settings");
}

export function getRemoteSettingsSummary(): string {
  const settings = getAllSettings();
  const locked = getLockedSettings();
  const lines: string[] = [
    "── Remote Managed Settings ──",
    `Total settings: ${settings.length}`,
    `Locked settings: ${locked.length}`,
    `Last synced: ${cachedSettings.lastSyncedAt ?? "Never"}`,
    `Sync URL: ${cachedSettings.syncUrl ?? "Not configured"}`,
    "",
  ];

  if (settings.length > 0) {
    lines.push("Settings:");
    for (const setting of settings) {
      const lockIcon = setting.locked ? "[Lock]" : "[Unlock]";
      lines.push(`  ${lockIcon} ${setting.key} = ${JSON.stringify(setting.value)} [${setting.source}]`);
    }
  }

  return lines.join("\n");
}
