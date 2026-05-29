export function getBashPromptAllowDescriptions(): string[] {
  return ['read-only filesystem checks', 'non-destructive git inspection', 'package metadata lookup']
}

export function getBashPromptDenyDescriptions(): string[] {
  return ['filesystem destruction', 'privilege escalation', 'remote code execution', 'disk formatting']
}

export function classifyBashCommand(command: string): 'allow' | 'ask' | 'deny' {
  const normalized = command.trim().toLowerCase()
  if (!normalized) return 'allow'
  if (/\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=|\bformat\s+[a-z]:/i.test(normalized)) return 'deny'
  if (/\bsudo\b|\bcurl\b.*\|\s*(bash|sh)|\bwget\b.*\|\s*(bash|sh)/i.test(normalized)) return 'ask'
  return 'allow'
}
