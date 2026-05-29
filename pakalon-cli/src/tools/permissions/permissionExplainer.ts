import type { PermissionRule, PermissionRuleSource, PermissionRuleValue } from './PermissionRule.js'

export type PermissionDecision = 'allow' | 'ask' | 'deny' | { action: 'allow' | 'ask' | 'deny'; reason?: string }

export function formatRuleSource(source: PermissionRuleSource): string {
  const labels: Record<PermissionRuleSource, string> = {
    projectSettings: 'project settings',
    userSettings: 'user settings',
    localSettings: 'local settings',
    cliArg: 'CLI argument',
    session: 'session',
    frontmatter: 'frontmatter',
    plugin: 'plugin',
    policySettings: 'policy settings',
    command: 'command',
    flagSettings: 'flag settings',
  }
  return labels[source]
}

export function formatPermissionMode(mode: string): string {
  return mode.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim()
}

export function explainPermissionDecision(
  toolName: string,
  decision: PermissionDecision,
  rules: PermissionRule[] = [],
): string {
  const action = typeof decision === 'string' ? decision : decision.action
  const reason = typeof decision === 'string' ? '' : decision.reason ?? ''
  const rule = rules[0]
  const source = rule ? ` from ${formatRuleSource(rule.source)}` : ''
  if (action === 'allow') return `${toolName} is allowed${source}${reason ? `: ${reason}` : ''}`
  if (action === 'deny') return `${toolName} is denied${source}${reason ? `: ${reason}` : ''}`
  return `${toolName} requires confirmation${source}${reason ? `: ${reason}` : ''}`
}
