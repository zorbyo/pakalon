import { EventEmitter } from 'events';
import logger from '@/utils/logger.js';

export type GrowthBookUserAttributes = {
  id: string;
  sessionId: string;
  deviceID: string;
  platform: 'win32' | 'darwin' | 'linux';
  apiBaseUrlHost?: string;
  organizationUUID?: string;
  accountUUID?: string;
  userType?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  firstTokenTime?: number;
  email?: string;
  appVersion?: string;
  github?: {
    actions?: boolean;
    workflow?: string;
    runner?: string;
  };
};

type StoredExperimentData = {
  experimentId: string;
  variationId: number;
  inExperiment?: boolean;
  hashAttribute?: string;
  hashValue?: string;
};

type GrowthBookRefreshListener = () => void | Promise<void>;

class SimpleSignal {
  private listeners: Set<GrowthBookRefreshListener> = new Set();

  subscribe(listener: GrowthBookRefreshListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(): void {
    this.listeners.forEach((listener) => {
      try {
        void Promise.resolve(listener()).catch((e) => {
          logger.error('Signal listener error:', e);
        });
      } catch (e) {
        logger.error('Signal listener error:', e);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

const experimentDataByFeature = new Map<string, StoredExperimentData>();
const remoteEvalFeatureValues = new Map<string, unknown>();
const pendingExposures = new Set<string>();
const loggedExposures = new Set<string>();

const refreshed = new SimpleSignal();

let client: unknown = null;
let clientCreatedWithAuth = false;
let reinitializingPromise: Promise<unknown> | null = null;
let envOverrides: Record<string, unknown> | null = null;
let envOverridesParsed = false;

const GROWTHBOOK_REFRESH_INTERVAL_MS =
  process.env.USER_TYPE !== 'ant' ? 6 * 60 * 60 * 1000 : 20 * 60 * 1000;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let beforeExitListener: (() => void) | null = null;

export function onGrowthBookRefresh(listener: GrowthBookRefreshListener): () => void {
  const unsubscribe = refreshed.subscribe(listener);
  if (remoteEvalFeatureValues.size > 0) {
    queueMicrotask(() => {
      if (remoteEvalFeatureValues.size > 0) {
        void Promise.resolve(listener()).catch((e) => {
          logger.error('GrowthBook refresh listener error:', e);
        });
      }
    });
  }
  return unsubscribe;
}

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true;
    if (process.env.USER_TYPE === 'ant') {
      const raw = process.env.PAKALON_INTERNAL_FC_OVERRIDES;
      if (raw) {
        try {
          envOverrides = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          logger.error(`GrowthBook: Failed to parse PAKALON_INTERNAL_FC_OVERRIDES: ${raw}`);
        }
      }
    }
  }
  return envOverrides;
}

export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides();
  return overrides !== null && feature in overrides;
}

function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (!baseUrl) return undefined;
  try {
    const host = new URL(baseUrl).host;
    if (host === 'api.anthropic.com') return undefined;
    return host;
  } catch {
    return undefined;
  }
}

function getUserAttributes(): GrowthBookUserAttributes {
  const platform: 'win32' | 'darwin' | 'linux' =
    process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';

  return {
    id: 'device-id',
    sessionId: 'session-id',
    deviceID: 'device-id',
    platform,
    apiBaseUrlHost: getApiBaseUrlHost(),
  };
}

function logExposureForFeature(feature: string): void {
  if (loggedExposures.has(feature)) {
    return;
  }

  const expData = experimentDataByFeature.get(feature);
  if (expData) {
    loggedExposures.add(feature);
  }
}

async function processRemoteEvalPayload(payload: { features?: Record<string, unknown> }): Promise<boolean> {
  if (!payload?.features || Object.keys(payload.features).length === 0) {
    return false;
  }

  experimentDataByFeature.clear();

  const transformedFeatures: Record<string, { defaultValue?: unknown; value?: unknown; [key: string]: unknown }> = {};
  for (const [key, feature] of Object.entries(payload.features)) {
    const f = feature as { value?: unknown; defaultValue?: unknown; [key: string]: unknown };
    if ('value' in f && !('defaultValue' in f)) {
      transformedFeatures[key] = {
        ...f,
        defaultValue: f.value,
      };
    } else {
      transformedFeatures[key] = f;
    }
  }

  remoteEvalFeatureValues.clear();
  for (const [key, feature] of Object.entries(transformedFeatures)) {
    const v = 'value' in feature ? feature.value : feature.defaultValue;
    if (v !== undefined) {
      remoteEvalFeatureValues.set(key, v);
    }
  }

  return true;
}

function isGrowthBookEnabled(): boolean {
  return process.env.PAKALON_ANALYTICS_ENABLED !== '0';
}

export function getAllGrowthBookFeatures(): Record<string, unknown> {
  if (remoteEvalFeatureValues.size > 0) {
    return Object.fromEntries(remoteEvalFeatureValues);
  }
  return {};
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return {};
}

export function setGrowthBookConfigOverride(feature: string, value: unknown): void {
  // No-op for now
}

export function clearGrowthBookConfigOverrides(): void {
  // No-op for now
}

export async function initializeGrowthBook(): Promise<unknown> {
  if (!isGrowthBookEnabled()) {
    return null;
  }

  const attributes = getUserAttributes();
  const clientKey = process.env.PAKALON_GB_CLIENT_KEY || '';

  const baseUrl = process.env.PAKALON_GB_BASE_URL || 'https://api.anthropic.com/';

  try {
    const { GrowthBook } = await import('@growthbook/growthbook');

    const growthBookClient = new GrowthBook({
      apiHost: baseUrl,
      clientKey,
      attributes,
      remoteEval: true,
      cacheKeyAttributes: ['id'],
    });

    client = growthBookClient;
    clientCreatedWithAuth = true;

    const initialized = growthBookClient
      .init({ timeout: 5000 })
      .then(async (result) => {
        if (process.env.USER_TYPE === 'ant') {
          logger.debug(
            `GrowthBook initialized, source: ${result.source}, success: ${result.success}`,
          );
        }

        const hadFeatures = await processRemoteEvalPayload(growthBookClient.getPayload() || {});

        if (hadFeatures) {
          Array.from(pendingExposures).forEach((feature) => {
            logExposureForFeature(feature);
          });
          pendingExposures.clear();
          refreshed.emit();
        }
      })
      .catch((error) => {
        logger.error('GrowthBook initialization error:', error);
      });

    setupPeriodicGrowthBookRefresh();

    return growthBookClient;
  } catch (error) {
    logger.error('Failed to initialize GrowthBook:', error);
    return null;
  }
}

export async function getFeatureValue<T>(feature: string, defaultValue: T): Promise<T> {
  const overrides = getEnvOverrides();
  if (overrides && feature in overrides) {
    return overrides[feature] as T;
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue;
  }

  if (remoteEvalFeatureValues.has(feature)) {
    return remoteEvalFeatureValues.get(feature) as T;
  }

  return defaultValue;
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(feature: string, defaultValue: T): T {
  const overrides = getEnvOverrides();
  if (overrides && feature in overrides) {
    return overrides[feature] as T;
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue;
  }

  if (experimentDataByFeature.has(feature)) {
    logExposureForFeature(feature);
  } else {
    pendingExposures.add(feature);
  }

  if (remoteEvalFeatureValues.has(feature)) {
    return remoteEvalFeatureValues.get(feature) as T;
  }

  return defaultValue;
}

export function checkGate_CACHED_OR_BLOCKING(gate: string): Promise<boolean> {
  return getFeatureValue(gate, false);
}

export function refreshGrowthBookAfterAuthChange(): void {
  if (!isGrowthBookEnabled()) {
    return;
  }

  try {
    resetGrowthBook();

    refreshed.emit();

    reinitializingPromise = initializeGrowthBook()
      .catch((error) => {
        logger.error('GrowthBook reinitialization error:', error);
        return null;
      })
      .finally(() => {
        reinitializingPromise = null;
      });
  } catch (error) {
    logger.error('GrowthBook refresh after auth change error:', error);
  }
}

export function resetGrowthBook(): void {
  stopPeriodicGrowthBookRefresh();

  if (client && typeof (client as { destroy?: () => void }).destroy === 'function') {
    (client as { destroy: () => void }).destroy();
  }
  client = null;
  clientCreatedWithAuth = false;
  reinitializingPromise = null;
  experimentDataByFeature.clear();
  pendingExposures.clear();
  loggedExposures.clear();
  remoteEvalFeatureValues.clear();
  envOverrides = null;
  envOverridesParsed = false;
  refreshed.clear();
}

export async function refreshGrowthBookFeatures(): Promise<void> {
  if (!isGrowthBookEnabled()) {
    return;
  }

  try {
    if (!client) return;

    const growthBookClient = client as { refreshFeatures?: () => Promise<unknown> };
    if (typeof growthBookClient.refreshFeatures === 'function') {
      await growthBookClient.refreshFeatures();
    }

    const payload = (client as { getPayload?: () => { features?: Record<string, unknown> } }).getPayload?.();
    if (payload) {
      await processRemoteEvalPayload(payload);
    }

    refreshed.emit();
  } catch (error) {
    logger.error('GrowthBook refresh features error:', error);
  }
}

export function setupPeriodicGrowthBookRefresh(): void {
  if (!isGrowthBookEnabled()) {
    return;
  }

  if (refreshInterval) {
    clearInterval(refreshInterval);
  }

  refreshInterval = setInterval(() => {
    void refreshGrowthBookFeatures();
  }, GROWTHBOOK_REFRESH_INTERVAL_MS);

  if (refreshInterval.unref) {
    refreshInterval.unref();
  }

  if (!beforeExitListener) {
    beforeExitListener = () => {
      stopPeriodicGrowthBookRefresh();
    };
    process.once('beforeExit', beforeExitListener);
  }
}

export function stopPeriodicGrowthBookRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (beforeExitListener) {
    process.removeListener('beforeExit', beforeExitListener);
    beforeExitListener = null;
  }
}