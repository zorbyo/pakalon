import logger from '@/utils/logger.js';

const DEFAULT_SYNC_COOLDOWN_MS = Number(process.env.PENPOT_SYNC_COOLDOWN_MS || 2000);
const DEFAULT_MAX_COOLDOWN_MS = 30000;

export interface SyncCooldownConfig {
  defaultCooldownMs: number;
  maxCooldownMs: number;
  forceSync: boolean;
}

type SyncFn = () => Promise<void>;

interface SyncEntry {
  lastSyncTime: number | null;
  lastRequestTime: number | null;
  nextSyncAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  pendingSyncFn: SyncFn | null;
  inFlight: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function now(): number {
  return Date.now();
}

function log(message: string): void {
  logger.info(`[PenpotCooldown] ${message}`);
}

export function createSyncCooldown(config?: Partial<SyncCooldownConfig>): {
  requestSync(fileKey: string, syncFn: SyncFn): Promise<boolean>;
  cancelSync(fileKey: string): void;
  forceSync(fileKey: string, syncFn: SyncFn): Promise<void>;
  getRemainingCooldown(fileKey: string): number;
  clearAll(): void;
} {
  const defaultCooldownMs = clamp(
    config?.defaultCooldownMs ?? DEFAULT_SYNC_COOLDOWN_MS,
    0,
    config?.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS,
  );
  const maxCooldownMs = Math.max(defaultCooldownMs, config?.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS);
  const forceSyncEnabled = config?.forceSync ?? false;

  const entries = new Map<string, SyncEntry>();

  const getEntry = (fileKey: string): SyncEntry => {
    const entry = entries.get(fileKey);
    if (entry) return entry;
    const created: SyncEntry = {
      lastSyncTime: null,
      lastRequestTime: null,
      nextSyncAt: null,
      timer: null,
      pendingSyncFn: null,
      inFlight: false,
    };
    entries.set(fileKey, created);
    return created;
  };

  const clearTimer = (entry: SyncEntry): void => {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.nextSyncAt = null;
  };

  const schedulePending = (fileKey: string, delayMs: number): void => {
    const entry = getEntry(fileKey);
    if (!entry.pendingSyncFn) return;

    clearTimer(entry);

    const effectiveDelay = clamp(delayMs, 0, maxCooldownMs);
    entry.nextSyncAt = now() + effectiveDelay;
    entry.timer = setTimeout(() => {
      void flushPending(fileKey);
    }, effectiveDelay);

    log(`Debounced sync for ${fileKey}; waiting ${effectiveDelay}ms`);
  };

  const flushPending = async (fileKey: string): Promise<void> => {
    const entry = getEntry(fileKey);
    if (!entry.pendingSyncFn) return;

    if (entry.inFlight) {
      schedulePending(fileKey, defaultCooldownMs);
      return;
    }

    const syncFn = entry.pendingSyncFn;
    entry.pendingSyncFn = null;
    clearTimer(entry);
    entry.inFlight = true;

    try {
      log(`Running delayed sync for ${fileKey}`);
      await syncFn();
      entry.lastSyncTime = now();
      log(`Sync complete for ${fileKey}`);
    } catch (error) {
      log(`Sync failed for ${fileKey}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      entry.inFlight = false;

      if (entry.pendingSyncFn) {
        schedulePending(fileKey, defaultCooldownMs);
      }
    }
  };

  const runForceSync = async (fileKey: string, syncFn: SyncFn): Promise<void> => {
    const entry = getEntry(fileKey);
    clearTimer(entry);
    entry.pendingSyncFn = null;
    entry.inFlight = true;

    try {
      log(`Force syncing ${fileKey}`);
      await syncFn();
      entry.lastSyncTime = now();
      entry.lastRequestTime = now();
      log(`Force sync complete for ${fileKey}`);
    } catch (error) {
      log(`Force sync failed for ${fileKey}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      entry.inFlight = false;
    }
  };

  const runImmediateSync = async (fileKey: string, syncFn: SyncFn): Promise<void> => {
    const entry = getEntry(fileKey);
    entry.inFlight = true;

    try {
      log(`Running immediate sync for ${fileKey}`);
      await syncFn();
      entry.lastSyncTime = now();
      entry.lastRequestTime = now();
      log(`Sync complete for ${fileKey}`);
    } catch (error) {
      log(`Sync failed for ${fileKey}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      entry.inFlight = false;
    }
  };

  return {
    async requestSync(fileKey: string, syncFn: SyncFn): Promise<boolean> {
      if (forceSyncEnabled) {
        await runForceSync(fileKey, syncFn);
        return true;
      }

      const entry = getEntry(fileKey);
      const lastRequestTime = entry.lastRequestTime ?? entry.lastSyncTime;
      const elapsed = lastRequestTime === null ? Number.POSITIVE_INFINITY : now() - lastRequestTime;
      const remaining = lastRequestTime === null ? 0 : Math.max(0, defaultCooldownMs - elapsed);

      if (entry.inFlight || remaining > 0) {
        entry.pendingSyncFn = syncFn;
        entry.lastRequestTime = now();
        schedulePending(fileKey, defaultCooldownMs);
        return false;
      }

      await runImmediateSync(fileKey, syncFn);
      return true;
    },

    cancelSync(fileKey: string): void {
      const entry = entries.get(fileKey);
      if (!entry) return;
      clearTimer(entry);
      entry.pendingSyncFn = null;
      log(`Cancelled pending sync for ${fileKey}`);
    },

    async forceSync(fileKey: string, syncFn: SyncFn): Promise<void> {
      await runForceSync(fileKey, syncFn);
    },

    getRemainingCooldown(fileKey: string): number {
      const entry = entries.get(fileKey);
      if (!entry) return 0;

      if (entry.nextSyncAt !== null) return Math.max(0, entry.nextSyncAt - now());

      const lastRequestTime = entry.lastRequestTime ?? entry.lastSyncTime;
      if (lastRequestTime === null) return 0;

      return Math.max(0, defaultCooldownMs - (now() - lastRequestTime));
    },

    clearAll(): void {
      for (const entry of entries.values()) {
        clearTimer(entry);
        entry.pendingSyncFn = null;
        entry.lastRequestTime = null;
        entry.inFlight = false;
      }
      entries.clear();
      log('Cleared all pending syncs');
    },
  };
}
