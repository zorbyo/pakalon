import { getCommandName, matchesCommandPattern } from '@/permissions/bashArity.js';

export function getBashPromptAllowDescriptions(): string[] {
  return ['read-only filesystem checks', 'non-destructive git inspection', 'package metadata lookup', 'git operations', 'package manager commands', 'docker operations', 'build tool commands']
}

export function getBashPromptDenyDescriptions(): string[] {
  return ['filesystem destruction', 'privilege escalation', 'remote code execution', 'disk formatting']
}

// Safe bash commands that are always allowed (using arity-aware matching)
const SAFE_BASH_COMMANDS = [
  // Git commands
  'git', 'git status', 'git log', 'git diff', 'git branch', 'git show', 'git blame',
  'git fetch', 'git pull', 'git remote', 'git stash', 'git tag',
  
  // Package managers
  'npm', 'npm run', 'npm install', 'npm test', 'npm list', 'npm view', 'npm info',
  'bun', 'bun run', 'bun install', 'bun test', 'bun add',
  'pnpm', 'pnpm run', 'pnpm install', 'pnpm test',
  'yarn', 'yarn run', 'yarn install', 'yarn test',
  'pip', 'pip install', 'pip list', 'pip show',
  'cargo', 'cargo build', 'cargo test', 'cargo run', 'cargo check', 'cargo clippy',
  'go', 'go build', 'go test', 'go run', 'go vet', 'go fmt',
  
  // Docker
  'docker', 'docker compose', 'docker ps', 'docker images', 'docker logs', 'docker inspect',
  'docker build', 'docker run', 'docker stop', 'docker start',
  
  // Kubernetes
  'kubectl', 'kubectl get', 'kubectl describe', 'kubectl logs', 'kubectl apply', 'kubectl delete',
  
  // Build tools
  'make', 'cmake', 'gradle', 'mvn', 'ant',
  
  // System inspection
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'grep', 'find', 'which', 'whoami',
  'date', 'env', 'ps', 'df', 'du', 'file', 'stat',
  
  // GitHub CLI
  'gh', 'gh pr', 'gh issue', 'gh repo', 'gh gist',
]

// Dangerous bash commands that are always denied
const DANGEROUS_BASH_COMMANDS = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=', 'format',
  ':(){:|:&};:', 'chmod -R 777 /', 'chown -R',
]

// Suspicious bash commands that require confirmation
const SUSPICIOUS_BASH_PATTERNS = [
  'sudo', 'curl.*|.*bash', 'wget.*|.*bash', 'eval', 'exec',
  'rm -rf', 'rm -r', 'rmdir', 'chmod', 'chown',
]

/**
 * Check if a bash command matches a safe command pattern
 */
function isSafeCommand(command: string): boolean {
  const commandName = getCommandName(command)
  return SAFE_BASH_COMMANDS.some(safe => 
    matchesCommandPattern(safe, commandName) || commandName === safe
  )
}

/**
 * Check if a bash command matches a dangerous pattern
 */
function isDangerousCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase()
  return DANGEROUS_BASH_COMMANDS.some(dangerous => 
    normalized.includes(dangerous.toLowerCase())
  )
}

/**
 * Check if a bash command matches a suspicious pattern
 */
function isSuspiciousCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase()
  return SUSPICIOUS_BASH_PATTERNS.some(pattern => 
    normalized.includes(pattern.toLowerCase())
  )
}

export function classifyBashCommand(command: string): 'allow' | 'ask' | 'deny' {
  const normalized = command.trim().toLowerCase()
  if (!normalized) return 'allow'
  
  // Check dangerous patterns first (highest priority)
  if (isDangerousCommand(normalized)) return 'deny'
  
  // Check suspicious patterns
  if (isSuspiciousCommand(normalized)) return 'ask'
  
  // Check safe commands using arity-aware matching
  if (isSafeCommand(normalized)) return 'allow'
  
  // Default to ask for unknown commands
  return 'ask'
}

/**
 * Get the command name from a bash command using arity-aware parsing
 */
export function getBashCommandName(command: string): string {
  return getCommandName(command)
}

/**
 * Check if a bash command matches a specific pattern
 */
export function matchesBashPattern(pattern: string, command: string): boolean {
  return matchesCommandPattern(pattern, command)
}
