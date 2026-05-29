export const SETTINGS_DIR = '.pakalon';
export const SETTINGS_FILENAME = 'settings.json';
export const LOCAL_SETTINGS_FILENAME = 'settings.local.json';
export const REMOTE_SETTINGS_FILENAME = 'settings.remote.json';
export const CHANGE_HISTORY_FILENAME = 'changes.json';

export const SETTINGS_SYNC_TIMEOUT_MS = 10000;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_FILE_SIZE_BYTES = 500 * 1024;

export const FILE_STABILITY_THRESHOLD_MS = 1000;
export const FILE_STABILITY_POLL_INTERVAL_MS = 500;
export const INTERNAL_WRITE_WINDOW_MS = 5000;
export const MDM_POLL_INTERVAL_MS = 30 * 60 * 1000;
export const DELETION_GRACE_MS = FILE_STABILITY_THRESHOLD_MS + FILE_STABILITY_POLL_INTERVAL_MS + 200;

export const DEFAULT_SETTINGS = {
  model: 'anthropic/claude-3-5-sonnet',
  theme: 'dark',
  permissionMode: 'normal',
  maxTurns: 100,
  temperature: 0.7,
  thinkingEnabled: false,
  fastMode: false,
  autoAccept: false,
} as const;

export const SYNC_KEYS = {
  USER_SETTINGS: '~/.pakalon/settings.json',
  USER_MEMORY: '~/.pakalon/memory.md',
  projectSettings: (projectId: string) => `projects/${projectId}/settings.local.json`,
  projectMemory: (projectId: string) => `projects/${projectId}/memory.local.md`,
} as const;