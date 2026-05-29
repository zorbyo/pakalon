import logger from '@/utils/logger.js';

export * from './types.js';
export * from './constants.js';
export * from './settings.js';
export * from './detectChanges.js';
export * from './applySettings.js';
export * from './settingsSync.js';

import * as settings from './settings.js';
import * as detectChanges from './detectChanges.js';
import * as applySettings from './applySettings.js';
import * as settingsSync from './settingsSync.js';

export interface RemoteSettings {
  endpoint?: string;
  apiKey?: string;
  syncInterval?: number;
  lastSyncAt?: string;
  enabled?: boolean;
}

export interface LocalSettings {
  model?: string;
  theme?: string;
  permissionMode?: string;
  maxTurns?: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  fastMode?: boolean;
  autoAccept?: boolean;
}

export interface SettingsChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
  source?: import('./types.js').SettingSource;
}

export interface SettingsSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean';
    default: unknown;
    description?: string;
    required?: boolean;
    options?: string[];
    min?: number;
    max?: number;
  };
}

export const DEFAULT_SETTINGS: SettingsJson = {
  model: 'anthropic/claude-3-5-sonnet',
  theme: 'dark',
  permissionMode: 'normal',
  maxTurns: 100,
  temperature: 0.7,
  thinkingEnabled: false,
  fastMode: false,
  autoAccept: false,
};

export type SettingsJson = settings.SettingsJson;
export type ValidationError = settings.ValidationError;
export type SettingSource = import('./types.js').SettingSource;
export type EditableSettingSource = import('./types.js').EditableSettingSource;

export const settingsChangeDetector = detectChanges.settingsChangeDetector;

export async function loadLocalSettings(): Promise<SettingsJson> {
  return settings.getInitialSettings();
}

export async function saveLocalSettings(newSettings: Partial<SettingsJson>): Promise<void> {
  const result = settings.updateSettingsForSource('userSettings', newSettings);
  if (result.error) {
    throw result.error;
  }
}

export async function getSetting<K extends keyof SettingsJson>(key: K): Promise<SettingsJson[K] | undefined> {
  const allSettings = settings.getInitialSettings();
  return allSettings[key];
}

export async function setSetting<K extends keyof SettingsJson>(key: K, value: SettingsJson[K]): Promise<void> {
  await saveLocalSettings({ [key]: value });
}

export async function getAllSettings(): Promise<SettingsJson> {
  return settings.getInitialSettings();
}

export async function resetSettings(): Promise<void> {
  settings.resetSettingsCache();
}

export async function loadRemoteSettings(): Promise<RemoteSettings> {
  return settingsSync.getRemoteSettingsConfig();
}

export async function saveRemoteSettings(remote: RemoteSettings): Promise<void> {
  await settingsSync.saveRemoteSettingsConfig(remote);
}

export async function syncRemoteSettings(): Promise<boolean> {
  return settingsSync.syncRemoteSettings();
}

export async function pushLocalSettingsToRemote(): Promise<boolean> {
  await settingsSync.uploadUserSettingsInBackground();
  return true;
}

export function onSettingsChange(listener: (change: SettingsChange) => void): () => void {
  return settings.onSettingsChange(listener as (change: settings.SettingsChange) => void);
}

export function subscribeToSourceChanges(
  source: SettingSource,
  listener: (change: SettingsChange) => void,
): () => void {
  return settings.subscribeToSourceChanges(source, listener as (change: settings.SettingsChange) => void);
}

export function getSettingsChangeHistory(limit = 50): SettingsChange[] {
  return settings.getSettingsChangeHistory(limit) as SettingsChange[];
}

export function exportSettings(): string {
  const localSettings = settings.getInitialSettings();
  const remoteSettings = settingsSync.getRemoteSettingsConfig();

  return JSON.stringify(
    {
      local: localSettings,
      remote: {
        enabled: remoteSettings.enabled,
        endpoint: remoteSettings.endpoint,
        lastSyncAt: remoteSettings.lastSyncAt,
      },
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

export async function importSettings(json: string): Promise<boolean> {
  try {
    const data = JSON.parse(json);

    if (data.local) {
      const result = settings.updateSettingsForSource('userSettings', data.local);
      if (result.error) return false;
    }

    if (data.remote) {
      await settingsSync.saveRemoteSettingsConfig(data.remote);
    }

    return true;
  } catch (err) {
    logger.error('Failed to import settings:', err);
    return false;
  }
}

export function getSettingsSchema(): SettingsSchema {
  return {
    model: {
      type: 'string',
      default: 'anthropic/claude-3-5-sonnet',
      description: 'Default LLM model to use',
      options: [
        'anthropic/claude-3-5-sonnet',
        'anthropic/claude-3-opus',
        'anthropic/claude-3-haiku',
        'openai/gpt-4o',
        'openai/gpt-4-turbo',
      ],
    },
    theme: {
      type: 'string',
      default: 'dark',
      description: 'UI theme',
      options: ['dark', 'light', 'system'],
    },
    permissionMode: {
      type: 'string',
      default: 'normal',
      description: 'Default permission mode',
      options: ['normal', 'plan', 'bypass', 'auto'],
    },
    maxTurns: {
      type: 'number',
      default: 100,
      description: 'Maximum conversation turns',
      min: 1,
      max: 1000,
    },
    temperature: {
      type: 'number',
      default: 0.7,
      description: 'LLM temperature',
      min: 0,
      max: 2,
    },
    thinkingEnabled: {
      type: 'boolean',
      default: false,
      description: 'Enable extended thinking',
    },
    fastMode: {
      type: 'boolean',
      default: false,
      description: 'Enable fast mode for quicker responses',
    },
    autoAccept: {
      type: 'boolean',
      default: false,
      description: 'Auto-accept dangerous operations without prompting',
    },
  };
}

export function applySettingsChange(source: SettingSource): void {
  applySettings.applySettingsChange(source);
}

export function notifySettingsChange(source: SettingSource): void {
  detectChanges.notifySettingsChange(source);
}

export async function initializeSettings(): Promise<void> {
  await detectChanges.settingsChangeDetector.initialize();
}

export function disposeSettings(): void {
  detectChanges.settingsChangeDetector.dispose();
  settingsSync.stopBackgroundSync();
}