export type PermissionRuleValue = 'allow' | 'ask' | 'deny'

export type PermissionRuleSource =
  | 'projectSettings'
  | 'userSettings'
  | 'localSettings'
  | 'cliArg'
  | 'session'
  | 'frontmatter'
  | 'plugin'
  | 'policySettings'
  | 'command'
  | 'flagSettings'

export interface PermissionRule {
  type: PermissionRuleValue
  value: string
  source: PermissionRuleSource
}

export const PERMISSION_RULE_SOURCES: readonly PermissionRuleSource[] = [
  'projectSettings',
  'userSettings',
  'localSettings',
  'cliArg',
  'session',
  'frontmatter',
  'plugin',
  'policySettings',
  'command',
  'flagSettings',
] as const
