/**
 * Bash Permissions Classifier
 * Determines whether bash commands require user permission based on security analysis
 */
import type { PermissionMode } from '@/tools/agent-tool/types';
import logger from '@/utils/logger.js';

export interface PermissionDecision {
  allowed: boolean;
  requiresPrompt: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  matchedRules: string[];
}

export interface BashPermissionContext {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  isAutomated?: boolean;
}

const DANGEROUS_COMMANDS = new Set([
  'rm',
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'format',
  ':(){:|:&};:',
  'sudo',
  'su',
  'chmod',
  'chown',
  'chgrp',
]);

const DESTRUCTIVE_PATTERNS = [
  /\brsync\s+.*--delete/,
  /\brm\s+.*(-rf|-r --force)/,
  /\bmv\s+.*\/\s*$/,
  /\bcp\s+.*\/\s*$/,
  /\bdd\s+.*of=\//,
  /\bmkfs\./,
  /\bfdisk\s+.*-W\s+always/i,
];

const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'nc',
  'netcat',
  'ncat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ftp',
  'telnet',
]);

const FILE_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'grep',
  'awk',
  'sed',
  'find',
  'ls',
  'stat',
  'file',
  'wc',
  'sort',
  'uniq',
  'cut',
  'tr',
]);

const MODIFYING_COMMANDS = new Set([
  'touch',
  'mkdir',
  'rmdir',
  'ln',
  'echo',
  'printf',
  'tee',
]);

const EDITING_COMMANDS = new Set([
  'vim',
  'vi',
  'nano',
  'emacs',
  'sed',
  'awk',
]);

const READ_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'find',
  'ls',
  'stat',
  'file',
  'wc',
]);

export function classifyBashPermission(
  context: BashPermissionContext,
  permissionMode?: PermissionMode,
): PermissionDecision {
  const { command, cwd, isAutomated = false } = context;

  if (permissionMode === 'bypassPermissions') {
    return {
      allowed: true,
      requiresPrompt: false,
      reason: 'Permission mode is bypassPermissions',
      riskLevel: 'low',
      matchedRules: [],
    };
  }

  if (permissionMode === 'acceptEdits') {
    return {
      allowed: true,
      requiresPrompt: false,
      reason: 'Permission mode is acceptEdits',
      riskLevel: 'low',
      matchedRules: [],
    };
  }

  const parsed = parseCommand(command);
  if (!parsed) {
    return {
      allowed: false,
      requiresPrompt: true,
      reason: 'Unable to parse command',
      riskLevel: 'high',
      matchedRules: ['unparseable'],
    };
  }

  const { cmd, args } = parsed;
  const matchedRules: string[] = [];
  let riskLevel: PermissionDecision['riskLevel'] = 'low';
  let requiresPrompt = false;
  let reason = '';

  if (DANGEROUS_COMMANDS.has(cmd)) {
    matchedRules.push(`dangerous_command:${cmd}`);
    riskLevel = 'critical';
    requiresPrompt = true;
    reason = `Command '${cmd}' is potentially destructive`;
  }

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      matchedRules.push(`destructive_pattern:${pattern.source}`);
      riskLevel = 'critical';
      requiresPrompt = true;
      reason = `Command contains destructive pattern`;
      break;
    }
  }

  if (NETWORK_COMMANDS.has(cmd)) {
    matchedRules.push(`network_command:${cmd}`);
    if (riskLevel < 'medium') {
      riskLevel = 'medium';
    }
    requiresPrompt = true;
    reason = reason || `Command '${cmd}' makes network requests`;
  }

  if (cmd === 'sudo' || cmd === 'su') {
    matchedRules.push('privilege_escalation');
    riskLevel = 'critical';
    requiresPrompt = true;
    reason = 'Command requires privilege escalation';
  }

  if (cmd === 'chmod' && args.some(arg => /[0-7]{3,4}/.test(arg))) {
    matchedRules.push('permission_modification');
    if (riskLevel < 'high') {
      riskLevel = 'high';
    }
    requiresPrompt = true;
    reason = reason || 'Command modifies file permissions';
  }

  if (cmd === 'rm') {
    const hasRecursive = args.includes('-r') || args.includes('-rf') || args.includes('-f');
    const hasRoot = args.includes('/') || args.includes('~');
    if (hasRecursive && hasRoot) {
      matchedRules.push('dangerous_rm');
      riskLevel = 'critical';
      requiresPrompt = true;
      reason = 'Recursive delete from root or home directory';
    }
  }

  if (cmd === 'curl' || cmd === 'wget') {
    const hasLocalhost = command.includes('localhost') || command.includes('127.0.0.1');
    const hasInternal = hasLocalhost || command.includes('.internal') || command.includes('.local');
    if (hasInternal) {
      matchedRules.push('internal_network_access');
      if (riskLevel < 'medium') {
        riskLevel = 'medium';
      }
      reason = reason || 'Accessing internal network';
    }
  }

  if (command.includes('eval') || command.includes('exec')) {
    matchedRules.push('shell_injection_risk');
    if (riskLevel < 'high') {
      riskLevel = 'high';
    }
    requiresPrompt = true;
    reason = reason || 'Command contains shell evaluation';
  }

  if (command.includes('$(') || command.includes('`') && !command.includes('\\$(')) {
    matchedRules.push('command_substitution');
    if (riskLevel < 'medium') {
      riskLevel = 'medium';
      requiresPrompt = true;
    }
    reason = reason || 'Command contains command substitution';
  }

  if (isAutomated && requiresPrompt) {
    matchedRules.push('automated_requires_prompt');
    reason = `Automated execution requires user confirmation: ${reason}`;
  }

  const allowed = riskLevel !== 'critical' || permissionMode === 'auto';

  return {
    allowed,
    requiresPrompt,
    reason: reason || 'Command is safe to execute',
    riskLevel,
    matchedRules,
  };
}

export function parseCommand(command: string): { cmd: string; args: string[] } | null {
  if (!command || typeof command !== 'string') {
    return null;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }

  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && inQuote) {
      escape = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return null;
  }

  return {
    cmd: tokens[0],
    args: tokens.slice(1),
  };
}

export function getCommandCategory(cmd: string): 'read' | 'write' | 'network' | 'system' | 'unknown' {
  if (READ_COMMANDS.has(cmd)) return 'read';
  if (MODIFYING_COMMANDS.has(cmd) || EDITING_COMMANDS.has(cmd)) return 'write';
  if (NETWORK_COMMANDS.has(cmd)) return 'network';
  if (DANGEROUS_COMMANDS.has(cmd)) return 'system';
  return 'unknown';
}

export function isReadOnlyCommand(command: string): boolean {
  const parsed = parseCommand(command);
  if (!parsed) return false;

  const { cmd } = parsed;
  return READ_COMMANDS.has(cmd) && !command.includes('>') && !command.includes('|');
}

export function isNetworkCommand(command: string): boolean {
  const parsed = parseCommand(command);
  if (!parsed) return false;
  return NETWORK_COMMANDS.has(parsed.cmd);
}

export function isDestructiveCommand(command: string): boolean {
  const parsed = parseCommand(command);
  if (!parsed) return false;

  if (DANGEROUS_COMMANDS.has(parsed.cmd)) return true;

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return true;
  }

  return false;
}

export function requiresPermission(command: string, permissionMode?: PermissionMode): boolean {
  if (permissionMode === 'bypassPermissions' || permissionMode === 'acceptEdits') {
    return false;
  }

  const decision = classifyBashPermission({ command }, permissionMode);
  return decision.requiresPrompt;
}

export function getRiskLevel(command: string): PermissionDecision['riskLevel'] {
  const decision = classifyBashPermission({ command });
  return decision.riskLevel;
}

export function createPermissionPrompt(
  command: string,
  context: BashPermissionContext,
  decision: PermissionDecision,
): string {
  const lines = [
    `A command is requesting permission to execute:`,
    ``,
    `Command: \`${command}\``,
    ``,
    `Risk Level: ${decision.riskLevel.toUpperCase()}`,
    `Reason: ${decision.reason}`,
    ``,
  ];

  if (decision.matchedRules.length > 0) {
    lines.push(`Matched Rules:`);
    for (const rule of decision.matchedRules) {
      lines.push(`  - ${rule}`);
    }
    lines.push('');
  }

  if (context.cwd) {
    lines.push(`Working Directory: ${context.cwd}`);
  }

  lines.push('');
  lines.push('Do you want to allow this command to execute?');

  return lines.join('\n');
}

export function shouldAutoAllow(command: string, permissionMode?: PermissionMode): boolean {
  if (permissionMode === 'bypassPermissions') return true;

  const decision = classifyBashPermission({ command }, permissionMode);
  return decision.riskLevel === 'low' && !decision.requiresPrompt;
}

export function shouldAutoDeny(command: string, permissionMode?: PermissionMode): boolean {
  if (permissionMode === 'bypassPermissions' || permissionMode === 'acceptEdits') return false;

  const decision = classifyBashPermission({ command }, permissionMode);
  return decision.riskLevel === 'critical' && decision.requiresPrompt;
}

export {
  DANGEROUS_COMMANDS,
  DESTRUCTIVE_PATTERNS,
  NETWORK_COMMANDS,
  FILE_COMMANDS,
  MODIFYING_COMMANDS,
  EDITING_COMMANDS,
  READ_COMMANDS,
};