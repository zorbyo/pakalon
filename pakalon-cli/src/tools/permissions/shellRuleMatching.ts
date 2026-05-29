export type ShellPermissionRule =
  | { type: 'exact'; command: string }
  | { type: 'prefix'; prefix: string }
  | { type: 'wildcard'; pattern: string }

export function permissionRuleExtractPrefix(rule: string): string | null {
  const match = rule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

export function hasWildcards(pattern: string): boolean {
  if (pattern.endsWith(':*')) return false
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== '*') continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && pattern[j] === '\\'; j--) backslashes++
    if (backslashes % 2 === 0) return true
  }
  return false
}

export function parsePermissionRule(rule: string): ShellPermissionRule {
  const prefix = permissionRuleExtractPrefix(rule)
  if (prefix !== null) return { type: 'prefix', prefix }
  if (hasWildcards(rule)) return { type: 'wildcard', pattern: rule }
  return { type: 'exact', command: rule }
}

function matchWildcardPattern(pattern: string, command: string): boolean {
  const normalized = pattern
    .replace(/\\\*/g, '\u0000STAR\u0000')
    .replace(/\\\\/g, '\u0000BACKSLASH\u0000')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\u0000STAR\u0000/g, '\\*')
    .replace(/\u0000BACKSLASH\u0000/g, '\\\\')
  return new RegExp(`^${normalized}$`, 's').test(command)
}

export function matchPermissionRule(command: string, rule: ShellPermissionRule): boolean {
  switch (rule.type) {
    case 'exact':
      return command === rule.command
    case 'prefix':
      return command === rule.prefix || command.startsWith(`${rule.prefix} `) || command.startsWith(rule.prefix)
    case 'wildcard':
      return matchWildcardPattern(rule.pattern, command)
  }
}

export function matchRules(command: string, rules: string[]): boolean {
  return rules.some((rule) => matchPermissionRule(command, parsePermissionRule(rule)))
}
