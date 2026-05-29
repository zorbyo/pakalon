import { z } from 'zod';

export const SETTING_SOURCES = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const;

export type SettingSource = (typeof SETTING_SOURCES)[number];

export type EditableSettingSource = Exclude<SettingSource, 'policySettings' | 'flagSettings'>;

export const SOURCES = ['localSettings', 'projectSettings', 'userSettings'] as const satisfies readonly EditableSettingSource[];

export const CLAUDE_CODE_SETTINGS_SCHEMA_URL = 'https://json.schemastore.org/pakalon-settings.json';

export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'project, gitignored'
    case 'flagSettings':
      return 'cli flag'
    case 'policySettings':
      return 'managed'
  }
}

export function getSourceDisplayName(source: SettingSource | 'plugin' | 'built-in'): string {
  switch (source) {
    case 'userSettings':
      return 'User'
    case 'projectSettings':
      return 'Project'
    case 'localSettings':
      return 'Local'
    case 'flagSettings':
      return 'Flag'
    case 'policySettings':
      return 'Managed'
    case 'plugin':
      return 'Plugin'
    case 'built-in':
      return 'Built-in'
  }
}

export function parseSettingSourcesFlag(flag: string): SettingSource[] {
  if (flag === '') return []

  const names = flag.split(',').map(s => s.trim())
  const result: SettingSource[] = []

  for (const name of names) {
    switch (name) {
      case 'user':
        result.push('userSettings')
        break
      case 'project':
        result.push('projectSettings')
        break
      case 'local':
        result.push('localSettings')
        break
      default:
        throw new Error(`Invalid setting source: ${name}. Valid options are: user, project, local`)
    }
  }

  return result
}