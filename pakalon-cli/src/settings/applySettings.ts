import {
  type SettingSource,
  type SettingsChange,
  getInitialSettings,
  getSettingsForSource,
  notifyChange,
  resetSettingsCache,
} from './settings.js';
import logger from '@/utils/logger.js';

export function applySettingsChange(source: SettingSource): void {
  logger.debug(`Applying settings change from ${source}`);

  resetSettingsCache();

  const newSettings = getInitialSettings();
  logger.debug(`Settings updated: ${Object.keys(newSettings).join(', ')}`);

  notifyChange(source);
}

export function applyRemoteSettingsChange(remoteSettings: Record<string, unknown>): void {
  logger.debug('Applying remote settings change');

  resetSettingsCache();
  notifyChange('policySettings');
}

export function applySettingsUpdate(
  source: SettingSource,
  updates: Record<string, unknown>,
): void {
  logger.debug(`Applying settings update to ${source}: ${Object.keys(updates).join(', ')}`);

  resetSettingsCache();
  notifyChange(source);
}

export function handleSettingsChangeEvent(change: SettingsChange): void {
  if (!change.source) {
    logger.warn('Settings change event missing source');
    return;
  }

  logger.debug(`Handling settings change event for ${change.source}: ${change.key}`);
  applySettingsChange(change.source);
}

export function getSettingsDiff(
  oldSettings: Record<string, unknown>,
  newSettings: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};

  const allKeys = new Set([...Object.keys(oldSettings), ...Object.keys(newSettings)]);

  for (const key of allKeys) {
    const oldValue = oldSettings[key];
    const newValue = newSettings[key];

    if (oldValue !== newValue) {
      diff[key] = { old: oldValue, new: newValue };
    }
  }

  return diff;
}

export function mergeSettingsChanges(
  baseSettings: Record<string, unknown>,
  changes: Array<{ source: SettingSource; settings: Record<string, unknown> }>,
): Record<string, unknown> {
  let merged = { ...baseSettings };

  for (const change of changes) {
    merged = { ...merged, ...change.settings };
  }

  return merged;
}

export function validateSettingsChange(
  newSettings: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof newSettings !== 'object' || newSettings === null) {
    errors.push('Settings must be an object');
    return { valid: false, errors };
  }

  if ('temperature' in newSettings) {
    const temp = newSettings.temperature;
    if (typeof temp !== 'number' || temp < 0 || temp > 2) {
      errors.push('Temperature must be a number between 0 and 2');
    }
  }

  if ('maxTurns' in newSettings) {
    const turns = newSettings.maxTurns;
    if (typeof turns !== 'number' || turns < 1 || !Number.isInteger(turns)) {
      errors.push('Max turns must be a positive integer');
    }
  }

  if ('theme' in newSettings) {
    const theme = newSettings.theme;
    if (!['dark', 'light', 'system'].includes(theme as string)) {
      errors.push('Theme must be one of: dark, light, system');
    }
  }

  if ('permissionMode' in newSettings) {
    const mode = newSettings.permissionMode;
    if (!['normal', 'plan', 'bypass', 'auto'].includes(mode as string)) {
      errors.push('Permission mode must be one of: normal, plan, bypass, auto');
    }
  }

  return { valid: errors.length === 0, errors };
}

export interface SettingsWithSources {
  effective: Record<string, unknown>;
  sources: Array<{ source: SettingSource; settings: Record<string, unknown> }>;
}

export function getSettingsWithSources(): SettingsWithSources {
  const sources: Array<{ source: SettingSource; settings: Record<string, unknown> }> = [];

  for (const source of ['userSettings', 'projectSettings', 'localSettings', 'policySettings'] as const) {
    const settings = getSettingsForSource(source);
    if (settings && Object.keys(settings).length > 0) {
      sources.push({ source, settings });
    }
  }

  return {
    effective: getInitialSettings(),
    sources,
  };
}