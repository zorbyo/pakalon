/**
 * Permission Mode Persistence
 *
 * Persists the user's permission mode (interactive, yolo, plan, bypass)
 * across sessions so it doesn't need to be re-selected each time.
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '@/utils/logger.js';

/**
 * Persist the permission mode for a project.
 */
export function persistPermissionMode(mode: string, projectDir: string): void {
  try {
    const settingsPath = getSettingsPath(projectDir);
    const settings = readSettings(settingsPath);

    settings.permissionMode = mode;
    settings.permissionModeUpdatedAt = new Date().toISOString();

    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    logger.debug('[PermissionModePersistence] Persisted mode', { mode, projectDir });
  } catch (err) {
    logger.warn('[PermissionModePersistence] Failed to persist mode', {
      mode,
      projectDir,
      error: String(err),
    });
  }
}

/**
 * Load the persisted permission mode for a project.
 */
export function loadPermissionMode(projectDir: string): string | null {
  try {
    const settingsPath = getSettingsPath(projectDir);
    const settings = readSettings(settingsPath);

    if (settings.permissionMode && typeof settings.permissionMode === 'string') {
      logger.debug('[PermissionModePersistence] Loaded mode', {
        mode: settings.permissionMode,
        projectDir,
      });
      return settings.permissionMode;
    }
  } catch (err) {
    logger.warn('[PermissionModePersistence] Failed to load mode', {
      projectDir,
      error: String(err),
    });
  }
  return null;
}

/**
 * Clear the persisted permission mode for a project.
 */
export function clearPermissionMode(projectDir: string): void {
  try {
    const settingsPath = getSettingsPath(projectDir);
    const settings = readSettings(settingsPath);

    delete settings.permissionMode;
    delete settings.permissionModeUpdatedAt;

    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    logger.debug('[PermissionModePersistence] Cleared mode', { projectDir });
  } catch (err) {
    logger.warn('[PermissionModePersistence] Failed to clear mode', {
      projectDir,
      error: String(err),
    });
  }
}

/**
 * Get the timestamp of when the mode was last updated.
 */
export function getPermissionModeUpdatedAt(projectDir: string): Date | null {
  try {
    const settingsPath = getSettingsPath(projectDir);
    const settings = readSettings(settingsPath);

    if (settings.permissionModeUpdatedAt) {
      return new Date(settings.permissionModeUpdatedAt);
    }
  } catch {
    // Ignore
  }
  return null;
}

// ── Internal helpers ──

function getSettingsPath(projectDir: string): string {
  return path.join(projectDir, '.pakalon', 'settings.local.json');
}

interface Settings {
  permissionMode?: string;
  permissionModeUpdatedAt?: string;
  [key: string]: unknown;
}

function readSettings(filePath: string): Settings {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as Settings;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
