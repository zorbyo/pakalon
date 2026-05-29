import type { ToolPermissionContext } from '../tool-types.js'
import {
  getAllowRules,
  getAskRules,
  getDenyRules,
  permissionRuleSourceDisplayString,
} from '../permissions.js'
import type { PermissionRule } from './PermissionRule.js'

export type ShadowType = 'ask' | 'deny'

export interface UnreachableRule {
  rule: PermissionRule
  reason: string
  shadowedBy: PermissionRule
  shadowType: ShadowType
  fix: string
}

export interface DetectUnreachableRulesOptions {
  sandboxAutoAllowEnabled: boolean
}

function isToolWide(rule: PermissionRule): boolean {
  return !rule.value.includes('(')
}

export function detectUnreachableRules(
  context: ToolPermissionContext,
  options: DetectUnreachableRulesOptions,
): UnreachableRule[] {
  const unreachable: UnreachableRule[] = []
  const allowRules = getAllowRules(context)
  const askRules = getAskRules(context)
  const denyRules = getDenyRules(context)

  for (const allowRule of allowRules) {
    const shadowingDeny = denyRules.find((rule) => isToolWide(rule) && rule.value === allowRule.value.split('(')[0])
    if (shadowingDeny) {
      unreachable.push({
        rule: allowRule,
        reason: `Blocked by "${shadowingDeny.value}" deny rule (from ${permissionRuleSourceDisplayString(shadowingDeny.source)})`,
        shadowedBy: shadowingDeny,
        shadowType: 'deny',
        fix: `Remove the "${shadowingDeny.value}" deny rule or the specific allow rule.`,
      })
      continue
    }

    const shadowingAsk = askRules.find((rule) => isToolWide(rule) && rule.value === allowRule.value.split('(')[0])
    if (shadowingAsk) {
      unreachable.push({
        rule: allowRule,
        reason: `Shadowed by "${shadowingAsk.value}" ask rule (from ${permissionRuleSourceDisplayString(shadowingAsk.source)})`,
        shadowedBy: shadowingAsk,
        shadowType: 'ask',
        fix: options.sandboxAutoAllowEnabled
          ? 'Remove the broad ask rule if sandbox auto-allow is intended.'
          : 'Remove the broad ask rule or the specific allow rule.',
      })
    }
  }

  return unreachable
}
