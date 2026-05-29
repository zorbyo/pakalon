export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bdd\s+if=.+\s+of=.+/i,
  /\bmkfs(\.|\s|$)/i,
  /\bfdisk\b/i,
  /\bformat\s+[a-z]:/i,
  /\bchmod\s+777\b/i,
  /\bcurl\b.*\|\s*(bash|sh|zsh)/i,
  /\bwget\b.*\|\s*(bash|sh|zsh)/i,
  /\bsudo\b/i,
] as const

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}
