import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { z } from 'zod';
import {
  type SettingSource,
  type EditableSettingSource,
  SETTING_SOURCES,
} from './types.js';
import {
  SETTINGS_DIR,
  SETTINGS_FILENAME,
  LOCAL_SETTINGS_FILENAME,
  REMOTE_SETTINGS_FILENAME,
  DEFAULT_SETTINGS,
  FILE_STABILITY_THRESHOLD_MS,
  FILE_STABILITY_POLL_INTERVAL_MS,
  INTERNAL_WRITE_WINDOW_MS,
} from './constants.js';
import logger from '@/utils/logger.js';

export interface SettingsJson {
  model?: string;
  theme?: string;
  permissionMode?: string;
  maxTurns?: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  fastMode?: boolean;
  autoAccept?: boolean;
  env?: Record<string, string>;
  permissions?: {
    allow?: string[];
    deny?: string[];
    ask?: string[];
    defaultMode?: string;
  };
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SettingsChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
  source?: SettingSource;
}

interface ParsedSettingsResult {
  settings: SettingsJson | null;
  errors: ValidationError[];
}

export interface ValidationError {
  file: string;
  path: string;
  message: string;
}

let settingsCache: SettingsJson | null = null;
let perSourceCache: Map<SettingSource, SettingsJson | null> = new Map();
let internalWriteMarks: Map<string, number> = new Map();
let changeListeners: Array<(change: SettingsChange) => void> = [];
let changeListenersBySource: Map<SettingSource, Array<(change: SettingsChange) => void>> = new Map();

export function getSettingsRootPathForSource(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return path.join(os.homedir(), '.pakalon');
    case 'projectSettings':
    case 'localSettings':
      return process.cwd();
    case 'flagSettings':
    case 'policySettings':
      return process.cwd();
  }
}

export function getSettingsFilePathForSource(source: SettingSource): string | undefined {
  const root = getSettingsRootPathForSource(source);
  switch (source) {
    case 'userSettings':
      return path.join(root, SETTINGS_FILENAME);
    case 'projectSettings':
      return path.join(root, '.pakalon', SETTINGS_FILENAME);
    case 'localSettings':
      return path.join(root, '.pakalon', LOCAL_SETTINGS_FILENAME);
    case 'policySettings':
      return path.join(os.homedir(), '.pakalon', REMOTE_SETTINGS_FILENAME);
    case 'flagSettings':
      return undefined;
  }
}

function getSettingsDir(): string {
  return path.join(os.homedir(), SETTINGS_DIR);
}

function getChangeHistoryPath(): string {
  return path.join(getSettingsDir(), 'changes.json');
}

export function parseSettingsFile(filePath: string): ParsedSettingsResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { settings: null, errors: [] };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.trim() === '') {
      return { settings: {}, errors: [] };
    }

    const data = JSON.parse(content);
    const result = SettingsSchema().safeParse(data);

    if (!result.success) {
      const errors = formatZodError(result.error, filePath);
      return { settings: null, errors };
    }

    return { settings: result.data, errors: [] };
  } catch (error) {
    if (isENOENT(error)) {
      return { settings: null, errors: [] };
    }
    logger.warn(`Failed to parse settings file ${filePath}:`, error);
    return { settings: null, errors: [] };
  }
}

function parseSettingsFileUncached(filePath: string): ParsedSettingsResult {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.trim() === '') {
      return { settings: {}, errors: [] };
    }

    const data = JSON.parse(content);
    const result = SettingsSchema().safeParse(data);

    if (!result.success) {
      const errors = formatZodError(result.error, filePath);
      return { settings: null, errors };
    }

    return { settings: result.data, errors: [] };
  } catch (error) {
    if (isENOENT(error)) {
      return { settings: null, errors: [] };
    }
    logger.warn(`Failed to parse settings file ${filePath}:`, error);
    return { settings: null, errors: [] };
  }
}

function isENOENT(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function getSettingsForSource(source: SettingSource): SettingsJson | null {
  const cached = perSourceCache.get(source);
  if (cached !== undefined) return cached;

  const result = getSettingsForSourceUncached(source);
  perSourceCache.set(source, result);
  return result;
}

function getSettingsForSourceUncached(source: SettingSource): SettingsJson | null {
  const filePath = getSettingsFilePathForSource(source);
  if (!filePath) return null;

  const { settings } = parseSettingsFile(filePath);
  return settings;
}

export function getInitialSettings(): SettingsJson {
  if (settingsCache) return settingsCache;

  const merged: SettingsJson = {};
  const seenFiles = new Set<string>();

  for (const source of SETTING_SOURCES) {
    const filePath = getSettingsFilePathForSource(source);
    if (!filePath) continue;

    const resolvedPath = path.resolve(filePath);
    if (seenFiles.has(resolvedPath)) continue;
    seenFiles.add(resolvedPath);

    const { settings } = parseSettingsFile(filePath);
    if (settings) {
      Object.assign(merged, settings);
    }
  }

  settingsCache = merged;
  return merged;
}

export function getSettingsWithErrors(): { settings: SettingsJson | null; errors: ValidationError[] } {
  const settings = getInitialSettings();
  const errors: ValidationError[] = [];
  const seenFiles = new Set<string>();

  for (const source of SETTING_SOURCES) {
    const filePath = getSettingsFilePathForSource(source);
    if (!filePath) continue;

    const resolvedPath = path.resolve(filePath);
    if (seenFiles.has(resolvedPath)) continue;
    seenFiles.add(resolvedPath);

    const { errors: fileErrors } = parseSettingsFile(filePath);
    errors.push(...fileErrors);
  }

  return { settings, errors };
}

export function updateSettingsForSource(
  source: EditableSettingSource,
  settings: SettingsJson,
): { error: Error | null } {
  if (source === 'policySettings' || source === 'flagSettings') {
    return { error: null };
  }

  const filePath = getSettingsFilePathForSource(source);
  if (!filePath) {
    return { error: null };
  }

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let existingSettings: SettingsJson = {};
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        existingSettings = JSON.parse(content);
      } catch {
        existingSettings = {};
      }
    }

    const updatedSettings = mergeWith(existingSettings, settings);
    markInternalWrite(filePath);
    fs.writeFileSync(filePath, JSON.stringify(updatedSettings, null, 2), 'utf-8');

    resetSettingsCache();
    return { error: null };
  } catch (error) {
    logger.error(`Failed to update settings for ${source}:`, error);
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function mergeWith(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const [key, srcValue] of Object.entries(source)) {
    if (srcValue === undefined) {
      delete result[key];
    } else if (Array.isArray(srcValue)) {
      result[key] = srcValue;
    } else if (typeof srcValue === 'object' && srcValue !== null) {
      result[key] = mergeWith(
        typeof result[key] === 'object' && result[key] !== null ? result[key] as Record<string, unknown> : {},
        srcValue as Record<string, unknown>,
      );
    } else {
      result[key] = srcValue;
    }
  }

  return result;
}

export function markInternalWrite(filePath: string): void {
  internalWriteMarks.set(filePath, Date.now());
}

export function consumeInternalWrite(filePath: string, windowMs: number = INTERNAL_WRITE_WINDOW_MS): boolean {
  const markTime = internalWriteMarks.get(filePath);
  if (markTime === undefined) return false;

  if (Date.now() - markTime > windowMs) {
    internalWriteMarks.delete(filePath);
    return false;
  }

  internalWriteMarks.delete(filePath);
  return true;
}

export function resetSettingsCache(): void {
  settingsCache = null;
  perSourceCache.clear();
}

export function SettingsSchema() {
  return z.object({
    model: z.string().optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    permissionMode: z.enum(['normal', 'plan', 'bypass', 'auto']).optional(),
    maxTurns: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    thinkingEnabled: z.boolean().optional(),
    fastMode: z.boolean().optional(),
    autoAccept: z.boolean().optional(),
    env: z.record(z.string()).optional(),
    permissions: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      ask: z.array(z.string()).optional(),
      defaultMode: z.string().optional(),
    }).optional(),
    hooks: z.record(z.unknown()).optional(),
  }).passthrough();
}

function formatZodError(error: z.ZodError, filePath: string): ValidationError[] {
  return error.errors.map(err => ({
    file: filePath,
    path: err.path.join('.'),
    message: err.message,
  }));
}

export function recordSettingsChange(change: SettingsChange): void {
  try {
    let changes: SettingsChange[] = [];
    const changeHistoryPath = getChangeHistoryPath();

    if (fs.existsSync(changeHistoryPath)) {
      const content = fs.readFileSync(changeHistoryPath, 'utf-8');
      changes = JSON.parse(content);
    }

    changes.push(change);

    if (changes.length > 100) {
      changes = changes.slice(-100);
    }

    fs.writeFileSync(changeHistoryPath, JSON.stringify(changes, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to record settings change:', err);
  }
}

export function onSettingsChange(listener: (change: SettingsChange) => void): () => void {
  changeListeners.push(listener);
  return () => {
    changeListeners = changeListeners.filter(l => l !== listener);
  };
}

export function subscribeToSourceChanges(
  source: SettingSource,
  listener: (change: SettingsChange) => void,
): () => void {
  if (!changeListenersBySource.has(source)) {
    changeListenersBySource.set(source, []);
  }
  changeListenersBySource.get(source)!.push(listener);

  return () => {
    const listeners = changeListenersBySource.get(source);
    if (listeners) {
      changeListenersBySource.set(
        source,
        listeners.filter(l => l !== listener),
      );
    }
  };
}

export function notifyChange(source: SettingSource, change?: Partial<SettingsChange>): void {
  const settingsChange: SettingsChange = {
    key: 'settings',
    oldValue: null,
    newValue: getInitialSettings(),
    timestamp: new Date().toISOString(),
    source,
    ...change,
  };

  resetSettingsCache();

  for (const listener of changeListeners) {
    try {
      listener(settingsChange);
    } catch (err) {
      logger.warn('Settings change listener error:', err);
    }
  }

  const sourceListeners = changeListenersBySource.get(source) || [];
  for (const listener of sourceListeners) {
    try {
      listener(settingsChange);
    } catch (err) {
      logger.warn(`Settings change listener error for ${source}:`, err);
    }
  }
}

export function getDefaultSettings(): SettingsJson {
  return { ...DEFAULT_SETTINGS };
}

export function getAllSettings(): SettingsJson {
  return getInitialSettings();
}

export function resetSettings(): void {
  resetSettingsCache();
}

export function getSettingsChangeHistory(limit = 50): SettingsChange[] {
  try {
    const changeHistoryPath = getChangeHistoryPath();
    if (!fs.existsSync(changeHistoryPath)) {
      return [];
    }

    const content = fs.readFileSync(changeHistoryPath, 'utf-8');
    const changes = JSON.parse(content) as SettingsChange[];
    return changes.slice(-limit);
  } catch (err) {
    logger.warn('Failed to read settings change history:', err);
    return [];
  }
}

export function getManagedSettingsKeysForLogging(settings: SettingsJson): string[] {
  const validSettings = SettingsSchema().strip().parse(settings) as Record<string, unknown>;
  return Object.keys(validSettings).sort();
}

export function settingsMergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    return [...new Set([...objValue, ...srcValue])];
  }
  return undefined;
}