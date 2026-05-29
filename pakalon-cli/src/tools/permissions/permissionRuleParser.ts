import type { PermissionRuleValue } from './PermissionRule.js'

const LEGACY_TOOL_NAME_ALIASES: Record<string, string> = {
  Task: 'task_create',
  AgentOutputTool: 'task_output',
  BashOutputTool: 'task_output',
  KillShell: 'task_stop',
  Brief: 'brief',
  FileRead: 'read_file',
  ReadFile: 'read_file',
  Grep: 'grep',
  Glob: 'glob',
  LSP: 'lsp',
}

export function normalizeLegacyToolName(name: string): string {
  return LEGACY_TOOL_NAME_ALIASES[name] ?? name
}

export function getLegacyToolNames(canonicalName: string): string[] {
  return Object.entries(LEGACY_TOOL_NAME_ALIASES)
    .filter(([, canonical]) => canonical === canonicalName)
    .map(([legacy]) => legacy)
}

export function escapeRuleContent(content: string): string {
  return content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function unescapeRuleContent(content: string): string {
  return content.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
}

function findFirstUnescapedChar(str: string, char: string): number {
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== char) continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && str[j] === '\\'; j--) backslashes++
    if (backslashes % 2 === 0) return i
  }
  return -1
}

function findLastUnescapedChar(str: string, char: string): number {
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] !== char) continue
    let backslashes = 0
    for (let j = i - 1; j >= 0 && str[j] === '\\'; j--) backslashes++
    if (backslashes % 2 === 0) return i
  }
  return -1
}

export function permissionRuleValueFromString(ruleString: string): PermissionRuleValue {
  const openParenIndex = findFirstUnescapedChar(ruleString, '(')
  if (openParenIndex === -1) return { toolName: normalizeLegacyToolName(ruleString) }

  const closeParenIndex = findLastUnescapedChar(ruleString, ')')
  if (closeParenIndex === -1 || closeParenIndex <= openParenIndex || closeParenIndex !== ruleString.length - 1) {
    return { toolName: normalizeLegacyToolName(ruleString) }
  }

  const toolName = ruleString.slice(0, openParenIndex)
  const rawContent = ruleString.slice(openParenIndex + 1, closeParenIndex)
  if (!toolName || rawContent === '' || rawContent === '*') {
    return { toolName: normalizeLegacyToolName(toolName || ruleString) }
  }

  return {
    toolName: normalizeLegacyToolName(toolName),
    ruleContent: unescapeRuleContent(rawContent),
  }
}

export function permissionRuleValueToString(ruleValue: PermissionRuleValue): string {
  if (!ruleValue.ruleContent) return ruleValue.toolName
  return `${ruleValue.toolName}(${escapeRuleContent(ruleValue.ruleContent)})`
}
